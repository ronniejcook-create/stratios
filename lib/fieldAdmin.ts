// Managing the field dictionary and the layout: what an organization's
// administrators can add and change.
//
// - A field the organization adds is its own row in field_definitions and is
//   edited directly.
// - A Stratios standard field is never edited. A change to one of its settings
//   is saved in field_settings, one row per setting. That row is the
//   "modified" flag: Stratios updates keep flowing to every setting without
//   one, and deleting the row puts the setting back to standard.
//
// Callers must check that the person is an administrator. Every function
// takes the database client of a transaction scoped to one organization.

import { listFields, OVERRIDABLE, type FieldDefinition, type OverridableSetting } from './fields'
import type { DataType } from './fieldFormat'
import { RECORD_TYPES, type Queryable, type RecordType } from './records'

export const DATA_TYPES: { value: DataType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'money', label: 'Money' },
  { value: 'percent', label: 'Percent' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'picklist', label: 'Pick List' },
]

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/** "Parking Ratio (per 1,000 SF)" -> "parkingRatioPer1000Sf" */
export function camelKey(name: string, fallback: string): string {
  const words = name
    .replace(/['’]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  const joined = words
    .map((word, index) => {
      const lower = word.toLowerCase()
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
    .slice(0, 60)
  // A key has to start with a letter.
  const key = /^[a-z]/.test(joined) ? joined : joined ? `${fallback}${joined.charAt(0).toUpperCase()}${joined.slice(1)}` : fallback
  return key
}

function firstFree(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; n < 10000; n += 1) {
    if (!taken.has(`${base}${n}`)) return `${base}${n}`
  }
  throw new Error('Could not find a free key')
}

function cleanList(values: unknown, max: number): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const value of values) {
    const text = String(value ?? '').trim().slice(0, 200)
    if (!text || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    cleaned.push(text)
    if (cleaned.length >= max) break
  }
  return cleaned
}

// ---------------------------------------------------------------------------
// Adding a field
// ---------------------------------------------------------------------------

export type NewFieldInput = {
  name: string
  appliesTo: string
  dataType: string
  unit: string
  options: string[]
  tracking: string
  /** The section to show it in, or the list to make it a column of. One or neither. */
  sectionId: string | null
  listId: string | null
  aiDescription: string
}

/** Adds a field for this organization. Its key is made from its name and never changes. */
export async function createField(client: Queryable, orgId: string, input: NewFieldInput): Promise<Result<{ id: string; key: string }>> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Enter a name for the field.' }
  if (name.length > 100) return { ok: false, error: 'The name is too long.' }
  if (!(RECORD_TYPES as readonly string[]).includes(input.appliesTo)) return { ok: false, error: 'Choose what the field belongs to.' }
  const appliesTo = input.appliesTo as RecordType
  const dataType = DATA_TYPES.find((type) => type.value === input.dataType)?.value
  if (!dataType) return { ok: false, error: 'Choose a type.' }
  const numeric = dataType === 'number' || dataType === 'money' || dataType === 'percent'
  const tracking = input.tracking === 'monthly' ? 'monthly' : 'single'
  if (tracking === 'monthly' && !numeric) return { ok: false, error: 'Only number, money and percent fields can be tracked by month.' }
  const options = dataType === 'picklist' ? cleanList(input.options, 100) : []
  if (dataType === 'picklist' && options.length === 0) return { ok: false, error: 'Enter at least one option for the pick list.' }
  const unit = numeric && dataType !== 'percent' ? input.unit.trim().slice(0, 30) || null : null

  let groupName = 'Other Fields'
  if (input.listId) {
    if (tracking === 'monthly') return { ok: false, error: 'A list column cannot be tracked by month.' }
    const list = await client.query(
      'select name from field_lists where id = $1 and (org_id is null or org_id = $2) and applies_to = $3',
      [input.listId, orgId, appliesTo],
    )
    if (list.rows.length === 0) return { ok: false, error: 'That list could not be found.' }
    groupName = list.rows[0].name
  } else if (input.sectionId) {
    const section = await client.query(
      `select name from sections where id = $1 and (org_id is null or org_id = $2) and applies_to = $3 and display_style <> 'list'`,
      [input.sectionId, orgId, appliesTo],
    )
    if (section.rows.length === 0) return { ok: false, error: 'That section could not be found.' }
    groupName = section.rows[0].name
  }

  // Keys are unique within a record type, across standard fields and this organization's.
  const existing = await client.query('select key from field_definitions where (org_id is null or org_id = $1) and applies_to = $2', [orgId, appliesTo])
  const key = firstFree(camelKey(name, 'field'), new Set(existing.rows.map((row) => String(row.key))))

  const order = await client.query(
    'select coalesce(max(sort_order), 0) + 10 as next from field_definitions where (org_id is null or org_id = $1) and applies_to = $2 and group_name = $3',
    [orgId, appliesTo, groupName],
  )
  const sortOrder = Number(order.rows[0].next)

  const created = await client.query(
    `insert into field_definitions
       (org_id, key, name, applies_to, data_type, unit, options, tracking, rollup, group_name, sort_order, ai_description, list_id, source_priority)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13::uuid, '{manual}')
     returning id::text as id`,
    [
      orgId, key, name, appliesTo, dataType, unit,
      options.length > 0 ? JSON.stringify(options) : null,
      tracking, tracking === 'monthly' ? 'last' : null,
      groupName, sortOrder, input.aiDescription.trim().slice(0, 1000) || null, input.listId,
    ],
  )
  const id = created.rows[0].id as string
  if (input.sectionId && !input.listId) {
    await client.query('insert into section_fields (org_id, section_id, field_id, position) values ($1, $2, $3, $4)', [orgId, input.sectionId, id, sortOrder])
  }
  return { ok: true, id, key }
}

// ---------------------------------------------------------------------------
// Changing a field's settings
// ---------------------------------------------------------------------------

export type FieldSettingsInput = {
  name: string
  aiDescription: string
  otherNames: string[]
  extractionHints: string
  sourcePriority: string[]
  whenEmpty: string
  whenDifferent: string
  manualOverride: string
  /** Only used for fields the organization added. */
  unit?: string
  options?: string[]
}

type CleanSettings = {
  name: string
  ai_description: string | null
  other_names: string[]
  extraction_hints: string | null
  source_priority: string[]
  when_empty: 'fill' | 'ask'
  when_different: 'ask' | 'replace' | 'never'
  manual_override: 'stays' | 'replaceable'
}

async function cleanSettings(client: Queryable, input: FieldSettingsInput): Promise<Result<{ settings: CleanSettings }>> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'The field needs a name.' }
  if (name.length > 100) return { ok: false, error: 'The name is too long.' }
  const sources = await client.query('select key from source_types where in_waterfall')
  const allowed = new Set(sources.rows.map((row) => String(row.key)))
  const sourcePriority = cleanList(input.sourcePriority, 10)
  if (sourcePriority.some((source) => !allowed.has(source))) return { ok: false, error: 'One of the sources is not recognized.' }
  if (sourcePriority.length === 0) return { ok: false, error: 'Choose at least one source.' }
  if (input.whenEmpty !== 'fill' && input.whenEmpty !== 'ask') return { ok: false, error: 'Choose what happens when the field is empty.' }
  if (input.whenDifferent !== 'ask' && input.whenDifferent !== 'replace' && input.whenDifferent !== 'never') {
    return { ok: false, error: 'Choose what happens when a different value arrives.' }
  }
  if (input.manualOverride !== 'stays' && input.manualOverride !== 'replaceable') return { ok: false, error: 'Choose how a hand-picked value behaves.' }
  return {
    ok: true,
    settings: {
      name,
      ai_description: input.aiDescription.trim().slice(0, 1000) || null,
      other_names: cleanList(input.otherNames, 30),
      extraction_hints: input.extractionHints.trim().slice(0, 1000) || null,
      source_priority: sourcePriority,
      when_empty: input.whenEmpty,
      when_different: input.whenDifferent,
      manual_override: input.manualOverride,
    },
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Saves a field's settings.
 *
 * For a field the organization added, the field itself is updated. For a
 * Stratios standard field, only settings that differ from the standard are
 * stored (and flagged as modified); a setting put back to its standard value
 * loses its flag. Returns which settings are now modified.
 */
export async function saveFieldSettings(
  client: Queryable,
  orgId: string,
  userId: string,
  fieldId: string,
  input: FieldSettingsInput,
): Promise<Result<{ modified: string[] }>> {
  const field = (await listFields(client, orgId)).find((candidate) => candidate.id === fieldId)
  if (!field) return { ok: false, error: 'That field could not be found.' }
  const cleaned = await cleanSettings(client, input)
  if (!cleaned.ok) return cleaned
  const { settings } = cleaned
  // A calculated field has no sources to rank.
  if (field.calculated) settings.source_priority = field.sourcePriority

  if (!field.standard) {
    const numeric = field.dataType === 'number' || field.dataType === 'money'
    const unit = numeric ? (input.unit ?? '').trim().slice(0, 30) || null : field.unit
    let options = field.options
    if (field.dataType === 'picklist') {
      options = cleanList(input.options ?? [], 100)
      if (options.length === 0) return { ok: false, error: 'Enter at least one option for the pick list.' }
    }
    await client.query(
      `update field_definitions
       set name = $3, ai_description = $4, other_names = $5::text[], extraction_hints = $6, source_priority = $7::text[],
           when_empty = $8, when_different = $9, manual_override = $10, unit = $11, options = $12::jsonb
       where id = $1 and org_id = $2`,
      [
        fieldId, orgId, settings.name, settings.ai_description, settings.other_names, settings.extraction_hints, settings.source_priority,
        settings.when_empty, settings.when_different, settings.manual_override, unit, options ? JSON.stringify(options) : null,
      ],
    )
    return { ok: true, modified: [] }
  }

  // Standard field: compare each setting with the Stratios standard value.
  const modified: string[] = []
  for (const setting of Object.keys(OVERRIDABLE) as OverridableSetting[]) {
    const property = OVERRIDABLE[setting]
    const standard = setting in field.standardValues ? field.standardValues[setting] : field[property]
    const next = settings[setting]
    if (same(standard, next)) {
      await client.query('delete from field_settings where org_id = $1 and field_id = $2 and setting = $3', [orgId, fieldId, setting])
      continue
    }
    modified.push(setting)
    await client.query(
      `insert into field_settings (org_id, field_id, setting, value, modified_by)
       values ($1, $2, $3, $4::jsonb, $5)
       on conflict (org_id, field_id, setting)
       do update set value = excluded.value,
                     modified_by = case when field_settings.value is distinct from excluded.value then excluded.modified_by else field_settings.modified_by end,
                     modified_at = case when field_settings.value is distinct from excluded.value then now() else field_settings.modified_at end`,
      [orgId, fieldId, setting, JSON.stringify(next), userId],
    )
  }
  return { ok: true, modified }
}

/** Puts a standard field back to the Stratios standard: one setting, or all of them. */
export async function resetFieldSettings(client: Queryable, orgId: string, fieldId: string, setting: string | null): Promise<void> {
  if (setting) {
    await client.query('delete from field_settings where org_id = $1 and field_id = $2 and setting = $3', [orgId, fieldId, setting])
  } else {
    await client.query('delete from field_settings where org_id = $1 and field_id = $2', [orgId, fieldId])
  }
}

/** Who changed each modified setting of a standard field, and when. */
export async function listModifications(client: Queryable, orgId: string, fieldId: string): Promise<{ setting: string; modifiedBy: string; modifiedAt: string }[]> {
  const { rows } = await client.query(
    `select setting, modified_by, to_char(modified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as modified_at
     from field_settings where org_id = $1 and field_id = $2`,
    [orgId, fieldId],
  )
  return rows.map((row) => ({ setting: row.setting, modifiedBy: row.modified_by, modifiedAt: row.modified_at }))
}

/**
 * Moves a field to a section (or to no section). For a standard field this is
 * stored as the organization's own placement, which replaces the standard one.
 */
export async function placeField(client: Queryable, orgId: string, fieldId: string, sectionId: string | null): Promise<Result> {
  const field = (await listFields(client, orgId)).find((candidate) => candidate.id === fieldId)
  if (!field) return { ok: false, error: 'That field could not be found.' }
  if (field.listId) return { ok: false, error: 'A list column stays with its list.' }

  await client.query('delete from section_fields where org_id = $1 and field_id = $2', [orgId, fieldId])
  if (!sectionId) {
    // No placement of its own: a standard field goes back to its standard section.
    return { ok: true }
  }
  const section = await client.query(
    `select id::text as id from sections where id = $1 and (org_id is null or org_id = $2) and applies_to = $3 and display_style <> 'list'`,
    [sectionId, orgId, field.appliesTo],
  )
  if (section.rows.length === 0) return { ok: false, error: 'That section could not be found.' }
  const standard = await client.query('select 1 as found from section_fields where org_id is null and field_id = $1 and section_id = $2', [fieldId, sectionId])
  if (standard.rows.length > 0) return { ok: true } // already there as standard

  const order = await client.query(
    'select coalesce(max(position), 0) + 10 as next from section_fields where (org_id is null or org_id = $1) and section_id = $2',
    [orgId, sectionId],
  )
  await client.query('insert into section_fields (org_id, section_id, field_id, position) values ($1, $2, $3, $4)', [
    orgId, sectionId, fieldId, Number(order.rows[0].next),
  ])
  return { ok: true }
}

/** Hides a field the organization added. Its values and history are kept. */
export async function retireField(client: Queryable, orgId: string, fieldId: string): Promise<Result> {
  const { rows } = await client.query(
    'update field_definitions set retired_at = now() where id = $1 and org_id = $2 and retired_at is null returning id::text as id',
    [fieldId, orgId],
  )
  if (rows.length === 0) return { ok: false, error: 'Only fields your organization added can be removed.' }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Layout: screens, sections and lists
// ---------------------------------------------------------------------------

async function freeLayoutKey(client: Queryable, orgId: string, table: 'screens' | 'sections' | 'field_lists', name: string, appliesTo: RecordType | null): Promise<string> {
  const { rows } = appliesTo
    ? await client.query(`select key from ${table} where (org_id is null or org_id = $1) and applies_to = $2`, [orgId, appliesTo])
    : await client.query(`select key from ${table} where org_id is null or org_id = $1`, [orgId])
  return firstFree(camelKey(name, table === 'screens' ? 'screen' : table === 'sections' ? 'section' : 'list'), new Set(rows.map((row) => String(row.key))))
}

function layoutName(raw: string): Result<{ name: string }> {
  const name = raw.trim()
  if (!name) return { ok: false, error: 'Enter a name.' }
  if (name.length > 60) return { ok: false, error: 'The name is too long.' }
  return { ok: true, name }
}

/** Adds a screen (a tab on the asset page) after the existing ones. */
export async function createScreen(client: Queryable, orgId: string, rawName: string): Promise<Result<{ id: string }>> {
  const checked = layoutName(rawName)
  if (!checked.ok) return checked
  const key = await freeLayoutKey(client, orgId, 'screens', checked.name, null)
  const order = await client.query('select coalesce(max(sort_order), 0) + 10 as next from screens where org_id is null or org_id = $1', [orgId])
  const { rows } = await client.query('insert into screens (org_id, key, name, sort_order) values ($1, $2, $3, $4) returning id::text as id', [
    orgId, key, checked.name, Number(order.rows[0].next),
  ])
  return { ok: true, id: rows[0].id }
}

async function insertSection(
  client: Queryable,
  orgId: string,
  input: { name: string; screenId: string; appliesTo: RecordType; displayStyle: 'form' | 'tiles' | 'list' },
): Promise<Result<{ id: string }>> {
  const screen = await client.query('select 1 as found from screens where id = $1 and (org_id is null or org_id = $2)', [input.screenId, orgId])
  if (screen.rows.length === 0) return { ok: false, error: 'That screen could not be found.' }
  const key = await freeLayoutKey(client, orgId, 'sections', input.name, input.appliesTo)
  const order = await client.query(
    'select coalesce(max(sort_order), 0) + 10 as next from sections where (org_id is null or org_id = $1) and screen_id = $2',
    [orgId, input.screenId],
  )
  const { rows } = await client.query(
    'insert into sections (org_id, screen_id, key, name, applies_to, display_style, sort_order) values ($1, $2, $3, $4, $5, $6, $7) returning id::text as id',
    [orgId, input.screenId, key, input.name, input.appliesTo, input.displayStyle, Number(order.rows[0].next)],
  )
  return { ok: true, id: rows[0].id }
}

/** Adds a section of fields to a screen, shown as a form or as tiles. */
export async function createSection(
  client: Queryable,
  orgId: string,
  input: { name: string; screenId: string; appliesTo: string; displayStyle: string },
): Promise<Result<{ id: string }>> {
  const checked = layoutName(input.name)
  if (!checked.ok) return checked
  if (!(RECORD_TYPES as readonly string[]).includes(input.appliesTo)) return { ok: false, error: 'Choose what the section belongs to.' }
  const displayStyle = input.displayStyle === 'tiles' ? 'tiles' : 'form'
  return insertSection(client, orgId, { name: checked.name, screenId: input.screenId, appliesTo: input.appliesTo as RecordType, displayStyle })
}

/**
 * Adds a list (fields grouped by row) with its own section on a screen.
 * Its columns are added afterward as fields.
 */
export async function createList(
  client: Queryable,
  orgId: string,
  input: { name: string; screenId: string; appliesTo: string },
): Promise<Result<{ id: string }>> {
  const checked = layoutName(input.name)
  if (!checked.ok) return checked
  if (!(RECORD_TYPES as readonly string[]).includes(input.appliesTo)) return { ok: false, error: 'Choose what the list belongs to.' }
  const appliesTo = input.appliesTo as RecordType
  const section = await insertSection(client, orgId, { name: checked.name, screenId: input.screenId, appliesTo, displayStyle: 'list' })
  if (!section.ok) return section
  const key = await freeLayoutKey(client, orgId, 'field_lists', checked.name, appliesTo)
  const { rows } = await client.query(
    'insert into field_lists (org_id, key, name, applies_to, section_id) values ($1, $2, $3, $4, $5) returning id::text as id',
    [orgId, key, checked.name, appliesTo, section.id],
  )
  return { ok: true, id: rows[0].id }
}

export type { FieldDefinition }
