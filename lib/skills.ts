// The skills library: named, plain-English know-how the agents pick from.
//
// A skill says when to use it and what to do. The chat analyst sees the list
// and opens the ones a task calls for; the agent that reads documents is
// handed every skill in use and applies those that fit the document, for
// example its type. Skills shape how an agent does something. They cannot
// give it abilities it has no tool for, or more access than the person has.
//
// Skills are layered the way fields are:
//   - Stratios standard skills (org_id null) are shared by every organization
//     and managed by Stratios administrators.
//   - An organization can add skills of its own.
//   - An organization can change or turn off a standard skill for itself.
//     Its version is stored as its own row with the standard skill's key and
//     replaces the standard one for that organization only. Removing that row
//     puts the organization back on the standard.
//
// Pass null as the organization to work on the standard itself.

import { slugify, type Queryable } from './records'

export const MAX_SKILL_INSTRUCTIONS = 20000
export const MAX_SKILLS = 100

/** standard = Stratios's, unchanged; modified = a standard skill this organization changed; own = added by this organization. */
export type SkillSource = 'standard' | 'modified' | 'own'

export type Skill = {
  id: string
  key: string
  name: string
  useWhen: string
  instructions: string
  enabled: boolean
  updatedAt: string
  source: SkillSource
  /** For a modified skill: the Stratios standard it replaces, for comparing. */
  standard?: { name: string; useWhen: string; instructions: string; enabled: boolean }
}

export type SkillInput = { name: string; useWhen: string; instructions: string; enabled: boolean }
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const COLUMNS = `id::text as id, org_id, key, name, use_when, instructions, enabled,
  to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at`

type Row = { id: string; orgId: string | null; key: string; name: string; useWhen: string; instructions: string; enabled: boolean; updatedAt: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toRow = (row: any): Row => ({
  id: row.id,
  orgId: row.org_id ?? null,
  key: row.key,
  name: row.name,
  useWhen: row.use_when,
  instructions: row.instructions,
  enabled: Boolean(row.enabled),
  updatedAt: row.updated_at,
})

async function readRows(client: Queryable, orgId: string | null): Promise<Row[]> {
  const { rows } = orgId
    ? await client.query(`select ${COLUMNS} from skills where org_id is null or org_id = $1`, [orgId])
    : await client.query(`select ${COLUMNS} from skills where org_id is null`)
  return rows.map(toRow)
}

/** Applies the layering: an organization's row replaces the standard row with the same key. */
function layer(rows: Row[]): Skill[] {
  const standard = new Map(rows.filter((row) => row.orgId === null).map((row) => [row.key, row]))
  const own = rows.filter((row) => row.orgId !== null)
  const replaced = new Set(own.map((row) => row.key))
  const skills: Skill[] = []
  for (const row of standard.values()) {
    if (!replaced.has(row.key)) skills.push({ ...strip(row), source: 'standard' })
  }
  for (const row of own) {
    const base = standard.get(row.key)
    skills.push(
      base
        ? { ...strip(row), source: 'modified', standard: { name: base.name, useWhen: base.useWhen, instructions: base.instructions, enabled: base.enabled } }
        : { ...strip(row), source: 'own' },
    )
  }
  return skills.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}

const strip = (row: Row) => ({ id: row.id, key: row.key, name: row.name, useWhen: row.useWhen, instructions: row.instructions, enabled: row.enabled, updatedAt: row.updatedAt })

/**
 * The skills an organization has: the standard ones (with its own changes
 * applied) plus those it added. With null, the Stratios standard alone.
 */
export async function listSkills(client: Queryable, orgId: string | null): Promise<Skill[]> {
  return layer(await readRows(client, orgId))
}

/**
 * One skill by id, as the organization sees it. If the id is a standard skill
 * the organization has changed, its own version is returned instead.
 */
export async function getSkill(client: Queryable, orgId: string | null, id: string): Promise<Skill | null> {
  const rows = await readRows(client, orgId)
  const row = rows.find((candidate) => candidate.id === id)
  if (!row) return null
  return layer(rows).find((skill) => skill.key === row.key) ?? null
}

/**
 * The skills in use for an organization, for an agent. Never throws: if the
 * library can't be read (for example its table isn't there yet), the agent
 * simply works without skills. Safe to call inside a transaction.
 */
export async function loadSkillsForAgent(client: Queryable, orgId: string): Promise<Skill[]> {
  try {
    await client.query('savepoint skills_read')
  } catch {
    return []
  }
  try {
    const skills = (await listSkills(client, orgId)).filter((skill) => skill.enabled)
    await client.query('release savepoint skills_read')
    return skills
  } catch (error) {
    console.error('The skills library could not be read; continuing without skills', error)
    await client.query('rollback to savepoint skills_read').catch(() => {})
    return []
  }
}

function clean(input: SkillInput): Result<{ value: SkillInput }> {
  const name = String(input.name ?? '').replace(/\s+/g, ' ').trim()
  const useWhen = String(input.useWhen ?? '').replace(/\s+/g, ' ').trim()
  const instructions = String(input.instructions ?? '').replace(/\r\n?/g, '\n').trim()
  if (!name) return { ok: false, error: 'Give the skill a name.' }
  if (name.length > 80) return { ok: false, error: 'The name is too long.' }
  if (!useWhen) return { ok: false, error: 'Say when the skill should be used, so the agents know when to pick it.' }
  if (useWhen.length > 400) return { ok: false, error: 'Keep "Use When" to a sentence or two.' }
  if (!instructions) return { ok: false, error: 'Write the skill\'s instructions.' }
  if (instructions.length > MAX_SKILL_INSTRUCTIONS) return { ok: false, error: `The instructions are too long (the limit is ${MAX_SKILL_INSTRUCTIONS.toLocaleString('en-US')} characters).` }
  return { ok: true, value: { name, useWhen, instructions, enabled: input.enabled !== false } }
}

/** True when another skill the organization sees already has this name. `exceptKey` is the skill being saved. */
function nameTaken(skills: Skill[], name: string, exceptKey: string | null): boolean {
  return skills.some((skill) => skill.key !== exceptKey && skill.name.toLowerCase() === name.toLowerCase())
}

/**
 * Adds a skill for an organization, or a standard skill (null; the client
 * must then be a Stratios administrator's, see withStratiosAdmin).
 */
export async function createSkill(client: Queryable, orgId: string | null, userId: string, input: SkillInput): Promise<Result<{ id: string }>> {
  const cleaned = clean(input)
  if (!cleaned.ok) return cleaned
  const { value } = cleaned
  const rows = await readRows(client, orgId)
  if (rows.filter((row) => row.orgId === orgId).length >= MAX_SKILLS) return { ok: false, error: `The library holds at most ${MAX_SKILLS} skills.` }
  if (nameTaken(layer(rows), value.name, null)) return { ok: false, error: 'A skill with that name already exists.' }
  // A new key must not match any skill this organization sees, or it would replace a standard skill by accident.
  // A new standard key must not match any organization's own skill either.
  const others = orgId ? { rows: [] } : await client.query('select key from skills')
  const taken = new Set([...rows.map((row) => row.key), ...others.rows.map((row) => String(row.key))])
  const base = slugify(value.name, 'skill')
  let key = base
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`
  const { rows: created } = await client.query(
    `insert into skills (org_id, key, name, use_when, instructions, enabled, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $7) returning id::text as id`,
    [orgId, key, value.name, value.useWhen, value.instructions, value.enabled, userId],
  )
  return { ok: true, id: created[0].id }
}

/**
 * Saves a skill.
 *
 * For an organization: its own skill is updated; a standard skill gets (or
 * updates) the organization's own version, which replaces the standard for
 * that organization. If what is saved matches the standard exactly, the
 * organization's version is removed, so it follows Stratios updates again.
 * Returns the id of the skill as the organization now sees it.
 *
 * With null: the standard skill itself is changed, for every organization
 * that has not changed it.
 */
export async function saveSkill(client: Queryable, orgId: string | null, userId: string, id: string, input: SkillInput): Promise<Result<{ id: string; source: SkillSource }>> {
  const cleaned = clean(input)
  if (!cleaned.ok) return cleaned
  const { value } = cleaned
  const rows = await readRows(client, orgId)
  const target = rows.find((row) => row.id === id)
  if (!target) return { ok: false, error: 'That skill could not be found.' }
  if (nameTaken(layer(rows), value.name, target.key)) return { ok: false, error: 'A skill with that name already exists.' }

  const update = (rowId: string) =>
    client.query(
      `update skills set name = $2, use_when = $3, instructions = $4, enabled = $5, updated_by = $6, updated_at = now() where id = $1`,
      [rowId, value.name, value.useWhen, value.instructions, value.enabled, userId],
    )

  if (orgId === null) {
    await update(target.id)
    return { ok: true, id: target.id, source: 'standard' }
  }

  const standard = rows.find((row) => row.orgId === null && row.key === target.key)
  const own = rows.find((row) => row.orgId === orgId && row.key === target.key)
  if (!standard) {
    if (!own) return { ok: false, error: 'That skill could not be found.' }
    await update(own.id)
    return { ok: true, id: own.id, source: 'own' }
  }
  const sameAsStandard = value.name === standard.name && value.useWhen === standard.useWhen && value.instructions === standard.instructions.trim() && value.enabled === standard.enabled
  if (sameAsStandard) {
    if (own) await client.query('delete from skills where id = $1 and org_id = $2', [own.id, orgId])
    return { ok: true, id: standard.id, source: 'standard' }
  }
  if (own) {
    await update(own.id)
    return { ok: true, id: own.id, source: 'modified' }
  }
  const { rows: created } = await client.query(
    `insert into skills (org_id, key, name, use_when, instructions, enabled, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $7) returning id::text as id`,
    [orgId, standard.key, value.name, value.useWhen, value.instructions, value.enabled, userId],
  )
  return { ok: true, id: created[0].id, source: 'modified' }
}

/**
 * Puts an organization back on the Stratios standard for a skill it changed.
 * Returns the standard skill's id, or null if there was nothing to reset.
 */
export async function resetSkill(client: Queryable, orgId: string, id: string): Promise<string | null> {
  const rows = await readRows(client, orgId)
  const own = rows.find((row) => row.id === id && row.orgId === orgId)
  const standard = own ? rows.find((row) => row.orgId === null && row.key === own.key) : undefined
  if (!own || !standard) return null
  await client.query('delete from skills where id = $1 and org_id = $2', [own.id, orgId])
  return standard.id
}

/**
 * Removes a skill: one the organization added, or (with null) a standard
 * skill. A standard skill an organization changed is reset, not removed.
 */
export async function deleteSkill(client: Queryable, orgId: string | null, id: string): Promise<Result> {
  const rows = await readRows(client, orgId)
  const target = rows.find((row) => row.id === id && row.orgId === orgId)
  if (!target) return { ok: false, error: 'That skill could not be found.' }
  if (orgId !== null && rows.some((row) => row.orgId === null && row.key === target.key)) {
    return { ok: false, error: 'This is a Stratios standard skill. Turn it off, or reset it to the standard.' }
  }
  await client.query('delete from skills where id = $1', [target.id])
  return { ok: true }
}

/** How many organizations have their own version of each standard skill, by key. For the Stratios library. */
export async function countSkillCustomizations(client: Queryable): Promise<Map<string, number>> {
  const { rows } = await client.query(
    `select o.key, count(distinct o.org_id)::int as total
     from skills o join skills s on s.org_id is null and s.key = o.key
     where o.org_id is not null group by o.key`,
  )
  return new Map(rows.map((row) => [String(row.key), Number(row.total)]))
}

/** The list the chat analyst sees: each skill's name and when to use it. It opens one with its read_skill tool. */
export function skillIndex(skills: Skill[]): string {
  return skills.map((skill) => `- ${skill.name}: ${skill.useWhen}`).join('\n')
}

/** Every skill in full, for the agent that reads a document in one pass and so cannot open them one at a time. */
export function skillsInFull(skills: Skill[], maxChars = 60000): string {
  const parts: string[] = []
  let used = 0
  for (const skill of skills) {
    const part = `<skill name="${skill.name.replace(/"/g, "'")}">\nUse when: ${skill.useWhen}\n\n${skill.instructions}\n</skill>`
    if (used + part.length > maxChars) break
    parts.push(part)
    used += part.length
  }
  return parts.join('\n\n')
}

/** What the skill screens' actions answer with. `id` is the skill to show next, when that changed. */
export type SkillActionResult = { ok: true; message: string; id?: string } | { ok: false; error: string }
