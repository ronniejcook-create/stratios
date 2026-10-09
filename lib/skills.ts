// The skills library: named, plain-English know-how the agents pick from.
//
// A skill says when to use it and what to do. The chat analyst sees the list
// and opens the ones a task calls for; the agent that reads documents is
// handed every enabled skill and applies those that fit the document, for
// example its type. Skills shape how an agent does something. They cannot
// give it abilities it has no tool for, or more access than the person has.
//
// The library is the Stratios standard (org_id null), managed by Stratios
// administrators and shared by every organization.

import { slugify, type Queryable } from './records'

export const MAX_SKILL_INSTRUCTIONS = 20000
export const MAX_SKILLS = 100

export type Skill = {
  id: string
  key: string
  name: string
  useWhen: string
  instructions: string
  enabled: boolean
  updatedAt: string
}

export type SkillInput = { name: string; useWhen: string; instructions: string; enabled: boolean }
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const COLUMNS = `id::text as id, key, name, use_when, instructions, enabled,
  to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toSkill = (row: any): Skill => ({
  id: row.id,
  key: row.key,
  name: row.name,
  useWhen: row.use_when,
  instructions: row.instructions,
  enabled: Boolean(row.enabled),
  updatedAt: row.updated_at,
})

/** Every standard skill, by name. */
export async function listSkills(client: Queryable): Promise<Skill[]> {
  const { rows } = await client.query(`select ${COLUMNS} from skills where org_id is null order by lower(name)`)
  return rows.map(toSkill)
}

export async function getSkill(client: Queryable, id: string): Promise<Skill | null> {
  const { rows } = await client.query(`select ${COLUMNS} from skills where id = $1 and org_id is null`, [id])
  return rows.length > 0 ? toSkill(rows[0]) : null
}

/**
 * The enabled skills, for an agent to use. Never throws: if the library
 * can't be read (for example its table isn't there yet), the agent simply
 * works without skills. Safe to call inside a transaction.
 */
export async function loadSkillsForAgent(client: Queryable): Promise<Skill[]> {
  try {
    await client.query('savepoint skills_read')
  } catch {
    return []
  }
  try {
    const skills = (await listSkills(client)).filter((skill) => skill.enabled)
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

async function nameTaken(client: Queryable, name: string, exceptId: string | null): Promise<boolean> {
  const { rows } = await client.query('select 1 as found from skills where org_id is null and lower(name) = lower($1) and id::text is distinct from $2', [name, exceptId])
  return rows.length > 0
}

/** Adds a standard skill. The client must be a Stratios administrator's (withStratiosAdmin). */
export async function createSkill(client: Queryable, userId: string, input: SkillInput): Promise<Result<{ id: string }>> {
  const cleaned = clean(input)
  if (!cleaned.ok) return cleaned
  const { value } = cleaned
  const existing = await client.query('select key from skills where org_id is null')
  if (existing.rows.length >= MAX_SKILLS) return { ok: false, error: `The library holds at most ${MAX_SKILLS} skills.` }
  if (await nameTaken(client, value.name, null)) return { ok: false, error: 'A skill with that name already exists.' }
  const taken = new Set(existing.rows.map((row) => String(row.key)))
  const base = slugify(value.name, 'skill')
  let key = base
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`
  const { rows } = await client.query(
    `insert into skills (org_id, key, name, use_when, instructions, enabled, created_by, updated_by)
     values (null, $1, $2, $3, $4, $5, $6, $6) returning id::text as id`,
    [key, value.name, value.useWhen, value.instructions, value.enabled, userId],
  )
  return { ok: true, id: rows[0].id }
}

/** Changes a standard skill. Its key stays the same. */
export async function updateSkill(client: Queryable, userId: string, id: string, input: SkillInput): Promise<Result> {
  const cleaned = clean(input)
  if (!cleaned.ok) return cleaned
  const { value } = cleaned
  if (await nameTaken(client, value.name, id)) return { ok: false, error: 'A skill with that name already exists.' }
  const { rows } = await client.query(
    `update skills set name = $2, use_when = $3, instructions = $4, enabled = $5, updated_by = $6, updated_at = now()
     where id = $1 and org_id is null returning id::text as id`,
    [id, value.name, value.useWhen, value.instructions, value.enabled, userId],
  )
  return rows.length > 0 ? { ok: true } : { ok: false, error: 'That skill could not be found.' }
}

export async function deleteSkill(client: Queryable, id: string): Promise<boolean> {
  const { rows } = await client.query('delete from skills where id = $1 and org_id is null returning id::text as id', [id])
  return rows.length > 0
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
