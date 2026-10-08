// Roles and field permissions.
//
// Administrators (org:admin in the sign-in system) always see and edit
// everything. Everyone else gets access through roles: the built-in Member
// role that everyone holds, plus any roles an administrator assigned to them.
// For one field, each role gives: its rule for that field, else its rule for
// the field's section, else the role's default. The most generous role wins.
//
// Every function takes the database client of a transaction scoped to one
// organization. Functions that change things must only be called for
// administrators; the callers check that.

import { camelKey } from './fieldAdmin'
import type { Queryable } from './records'

export const LEVELS = ['hidden', 'view', 'edit'] as const
export type Level = (typeof LEVELS)[number]
export const LEVEL_LABELS: Record<Level, string> = { hidden: 'Hidden', view: 'View', edit: 'Edit' }
const RANK: Record<Level, number> = { hidden: 0, view: 1, edit: 2 }

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value)
}

export type Role = {
  id: string
  key: string
  name: string
  defaultLevel: Level
  /** True for the built-in role that every person in the organization holds. */
  isMember: boolean
  memberCount: number
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/**
 * Makes sure the organization has its built-in Member role. New organizations
 * start with members able to see every field but not change them.
 */
async function ensureMemberRole(client: Queryable, orgId: string, userId: string): Promise<void> {
  await client.query(
    `insert into roles (org_id, key, name, default_level, is_member, created_by)
     values ($1, 'member', 'Member', 'view', true, $2)
     on conflict do nothing`,
    [orgId, userId],
  )
}

/** Every role in the organization, the built-in Member role first. */
export async function listRoles(client: Queryable, orgId: string, userId: string): Promise<Role[]> {
  await ensureMemberRole(client, orgId, userId)
  const { rows } = await client.query(
    `select r.id::text as id, r.key, r.name, r.default_level, r.is_member,
            (select count(*)::int from member_roles m where m.role_id = r.id and m.org_id = r.org_id) as member_count
     from roles r
     where r.org_id = $1
     order by r.is_member desc, r.name`,
    [orgId],
  )
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    defaultLevel: row.default_level,
    isMember: Boolean(row.is_member),
    memberCount: Number(row.member_count),
  }))
}

function roleName(raw: string): Result<{ name: string }> {
  const name = raw.trim()
  if (!name) return { ok: false, error: 'Enter a name for the role.' }
  if (name.length > 60) return { ok: false, error: 'The name is too long.' }
  if (/^(administrator|admin|member)$/i.test(name)) return { ok: false, error: 'That name is already used by a built-in role.' }
  return { ok: true, name }
}

export async function createRole(client: Queryable, orgId: string, userId: string, rawName: string, defaultLevel: string): Promise<Result<{ id: string }>> {
  const checked = roleName(rawName)
  if (!checked.ok) return checked
  if (!isLevel(defaultLevel)) return { ok: false, error: 'Choose a default access level.' }
  const existing = await client.query('select key, name from roles where org_id = $1', [orgId])
  if (existing.rows.some((row) => String(row.name).toLowerCase() === checked.name.toLowerCase())) return { ok: false, error: 'A role with that name already exists.' }
  const taken = new Set(existing.rows.map((row) => String(row.key)))
  taken.add('member').add('administrator')
  let key = camelKey(checked.name, 'role')
  for (let n = 2; taken.has(key); n += 1) key = `${camelKey(checked.name, 'role')}${n}`
  const { rows } = await client.query(
    'insert into roles (org_id, key, name, default_level, created_by) values ($1, $2, $3, $4, $5) returning id::text as id',
    [orgId, key, checked.name, defaultLevel, userId],
  )
  return { ok: true, id: rows[0].id }
}

/** Changes a role's name and default access. The built-in Member role keeps its name. */
export async function updateRole(client: Queryable, orgId: string, roleId: string, rawName: string, defaultLevel: string): Promise<Result> {
  if (!isLevel(defaultLevel)) return { ok: false, error: 'Choose a default access level.' }
  const role = await client.query('select is_member, name from roles where id = $1 and org_id = $2', [roleId, orgId])
  if (role.rows.length === 0) return { ok: false, error: 'That role could not be found.' }
  let name = String(role.rows[0].name)
  if (!role.rows[0].is_member) {
    const checked = roleName(rawName)
    if (!checked.ok) return checked
    const clash = await client.query('select 1 as found from roles where org_id = $1 and lower(name) = lower($2) and id <> $3', [orgId, checked.name, roleId])
    if (clash.rows.length > 0) return { ok: false, error: 'A role with that name already exists.' }
    name = checked.name
  }
  await client.query('update roles set name = $3, default_level = $4 where id = $1 and org_id = $2', [roleId, orgId, name, defaultLevel])
  return { ok: true }
}

/** Removes a role, with its assignments and rules. The built-in Member role can't be removed. */
export async function deleteRole(client: Queryable, orgId: string, roleId: string): Promise<Result> {
  const { rows } = await client.query('delete from roles where id = $1 and org_id = $2 and not is_member returning id::text as id', [roleId, orgId])
  if (rows.length === 0) return { ok: false, error: 'That role could not be removed.' }
  return { ok: true }
}

/** The people (sign-in account ids) assigned to a role. */
export async function listRoleMembers(client: Queryable, orgId: string, roleId: string): Promise<string[]> {
  const { rows } = await client.query('select user_id from member_roles where org_id = $1 and role_id = $2', [orgId, roleId])
  return rows.map((row) => String(row.user_id))
}

/** Sets exactly who holds a role. `userIds` must already be checked as members of the organization. */
export async function setRoleMembers(client: Queryable, orgId: string, adminId: string, roleId: string, userIds: string[]): Promise<Result> {
  const role = await client.query('select is_member from roles where id = $1 and org_id = $2', [roleId, orgId])
  if (role.rows.length === 0) return { ok: false, error: 'That role could not be found.' }
  if (role.rows[0].is_member) return { ok: false, error: 'Everyone holds the Member role already.' }
  const wanted = [...new Set(userIds)]
  await client.query('delete from member_roles where org_id = $1 and role_id = $2 and not (user_id = any($3::text[]))', [orgId, roleId, wanted])
  for (const userId of wanted) {
    await client.query(
      'insert into member_roles (org_id, user_id, role_id, assigned_by) values ($1, $2, $3, $4) on conflict do nothing',
      [orgId, userId, roleId, adminId],
    )
  }
  return { ok: true }
}

export type Rules = { sections: Record<string, Level>; fields: Record<string, Level> }

/** A role's rules: the level it has for particular sections and fields. */
export async function getRules(client: Queryable, orgId: string, roleId: string): Promise<Rules> {
  const { rows } = await client.query(
    'select section_id::text as section_id, field_id::text as field_id, level from field_permissions where org_id = $1 and role_id = $2',
    [orgId, roleId],
  )
  const rules: Rules = { sections: {}, fields: {} }
  for (const row of rows) {
    if (row.section_id) rules.sections[row.section_id] = row.level
    else if (row.field_id) rules.fields[row.field_id] = row.level
  }
  return rules
}

/**
 * Replaces a role's rules. Sections and fields left out follow the role's
 * default (sections) or their section (fields).
 */
export async function saveRules(client: Queryable, orgId: string, roleId: string, rules: Rules): Promise<Result> {
  const role = await client.query('select 1 as found from roles where id = $1 and org_id = $2', [roleId, orgId])
  if (role.rows.length === 0) return { ok: false, error: 'That role could not be found.' }
  // Only sections and fields this organization can see may be given rules.
  const sections = await client.query('select id::text as id from sections where org_id is null or org_id = $1', [orgId])
  const fields = await client.query('select id::text as id from field_definitions where org_id is null or org_id = $1', [orgId])
  const sectionIds = new Set(sections.rows.map((row) => String(row.id)))
  const fieldIds = new Set(fields.rows.map((row) => String(row.id)))

  await client.query('delete from field_permissions where org_id = $1 and role_id = $2', [orgId, roleId])
  for (const [sectionId, level] of Object.entries(rules.sections)) {
    if (!sectionIds.has(sectionId) || !isLevel(level)) continue
    await client.query('insert into field_permissions (org_id, role_id, section_id, level) values ($1, $2, $3, $4)', [orgId, roleId, sectionId, level])
  }
  for (const [fieldId, level] of Object.entries(rules.fields)) {
    if (!fieldIds.has(fieldId) || !isLevel(level)) continue
    await client.query('insert into field_permissions (org_id, role_id, field_id, level) values ($1, $2, $3, $4)', [orgId, roleId, fieldId, level])
  }
  return { ok: true }
}

/** What one person may do. */
export type Access = {
  admin: boolean
  /** May add assets, properties, buildings, floors, units and addresses. */
  canAddRecords: boolean
  /** The person's level for a field shown in a section (null = not in any section). */
  fieldLevel: (fieldId: string, sectionId: string | null) => Level
  /** The person's level for a section as a whole, used for lists. */
  sectionLevel: (sectionId: string) => Level
}

const FULL_ACCESS: Access = { admin: true, canAddRecords: true, fieldLevel: () => 'edit', sectionLevel: () => 'edit' }

/** Works out a person's access from the Member role and the roles assigned to them. */
export async function loadAccess(client: Queryable, orgId: string, userId: string, isAdmin: boolean): Promise<Access> {
  if (isAdmin) return FULL_ACCESS
  await ensureMemberRole(client, orgId, userId)
  const roles = await client.query(
    `select r.id::text as id, r.default_level
     from roles r
     where r.org_id = $1
       and (r.is_member or exists (select 1 from member_roles m where m.role_id = r.id and m.org_id = r.org_id and m.user_id = $2))`,
    [orgId, userId],
  )
  const roleIds = roles.rows.map((row) => String(row.id))
  const rules = await client.query(
    `select role_id::text as role_id, section_id::text as section_id, field_id::text as field_id, level
     from field_permissions where org_id = $1 and role_id = any($2::uuid[])`,
    [orgId, roleIds],
  )
  const sectionRule = new Map<string, Level>()
  const fieldRule = new Map<string, Level>()
  for (const row of rules.rows) {
    if (row.section_id) sectionRule.set(`${row.role_id}:${row.section_id}`, row.level)
    else if (row.field_id) fieldRule.set(`${row.role_id}:${row.field_id}`, row.level)
  }
  const best = (levels: Level[]): Level => levels.reduce<Level>((top, level) => (RANK[level] > RANK[top] ? level : top), 'hidden')

  const sectionLevel = (sectionId: string): Level =>
    best(roles.rows.map((role) => sectionRule.get(`${role.id}:${sectionId}`) ?? (role.default_level as Level)))
  const fieldLevel = (fieldId: string, sectionId: string | null): Level =>
    best(
      roles.rows.map(
        (role) =>
          fieldRule.get(`${role.id}:${fieldId}`) ??
          (sectionId ? sectionRule.get(`${role.id}:${sectionId}`) : undefined) ??
          (role.default_level as Level),
      ),
    )
  return {
    admin: false,
    canAddRecords: roles.rows.some((role) => role.default_level === 'edit'),
    fieldLevel,
    sectionLevel,
  }
}

/**
 * The section a field is shown in, for permission checks when saving:
 * a list column's list section, or the field's own section, or null.
 */
export async function sectionOfField(client: Queryable, orgId: string, fieldId: string): Promise<string | null> {
  const list = await client.query(
    `select l.section_id::text as section_id
     from field_definitions f join field_lists l on l.id = f.list_id
     where f.id = $1 and (f.org_id is null or f.org_id = $2)`,
    [fieldId, orgId],
  )
  if (list.rows.length > 0) return list.rows[0].section_id ?? null
  // An organization's own placement replaces the standard one.
  const placed = await client.query(
    `select section_id::text as section_id from section_fields
     where field_id = $1 and (org_id is null or org_id = $2)
     order by (org_id is null), position limit 1`,
    [fieldId, orgId],
  )
  return placed.rows[0]?.section_id ?? null
}
