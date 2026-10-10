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
//
// The functions that add things take an `owner`: the organization the new
// field, screen, section or list belongs to, or null to add it to the Stratios
// standard for every organization. Null is only for the Master Library, inside
// withStratiosAdmin.

import { listFields, OVERRIDABLE, parentFieldOf, type FieldDefinition, type OverridableSetting } from './fields'
import type { DataType } from './fieldFormat'
import { keyFromLabel, MAX_OPTION_LABEL, MAX_OPTIONS, normalizeOptions, storedOptions, uniqueKey, type FieldOption } from './optionLists'
import { RECORD_TYPES, tableFor, type Queryable, type RecordType } from './records'

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

/** Adds a field for one organization, or a standard field (owner null). Its key is made from its name and never changes. */
export async function createField(client: Queryable, orgId: string | null, input: NewFieldInput): Promise<Result<{ id: string; key: string }>> {
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

  // Keys are unique within a record type, across standard fields and this
  // organization's. A new standard field must not clash with any organization's.
  const existing = orgId
    ? await client.query('select key from field_definitions where (org_id is null or org_id = $1) and applies_to = $2', [orgId, appliesTo])
    : await client.query('select key from field_definitions where applies_to = $1', [appliesTo])
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
      options.length > 0 ? JSON.stringify(storedOptions(normalizeOptions(options))) : null,
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
  agentInstructions: string
  whenEmpty: string
  whenDifferent: string
  manualOverride: string
  /** Only used for fields the organization added. */
  unit?: string
  options?: string[]
  /** Only for a field the organization added, and only while it has no values. */
  dataType?: string
}

/** The longest Agent Instructions text a field can hold. */
export const MAX_INSTRUCTIONS = 20000

type CleanSettings = {
  name: string
  ai_description: string | null
  agent_instructions: string | null
  when_empty: 'fill' | 'ask'
  when_different: 'ask' | 'replace' | 'never'
  manual_override: 'stays' | 'replaceable'
}

function cleanSettings(input: FieldSettingsInput): Result<{ settings: CleanSettings }> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'The field needs a name.' }
  if (name.length > 100) return { ok: false, error: 'The name is too long.' }
  const instructions = (input.agentInstructions ?? '').replace(/\r\n?/g, '\n').trim()
  if (instructions.length > MAX_INSTRUCTIONS) return { ok: false, error: `The agent instructions are too long (the limit is ${MAX_INSTRUCTIONS.toLocaleString('en-US')} characters).` }
  if (input.whenEmpty !== 'fill' && input.whenEmpty !== 'ask') return { ok: false, error: 'Choose what happens when the field is empty.' }
  if (input.whenDifferent !== 'ask' && input.whenDifferent !== 'replace' && input.whenDifferent !== 'never') {
    return { ok: false, error: 'Choose what happens when a different value arrives.' }
  }
  if (input.manualOverride !== 'stays' && input.manualOverride !== 'replaceable') return { ok: false, error: 'Choose what happens when a value is manually entered.' }
  return {
    ok: true,
    settings: {
      name,
      ai_description: input.aiDescription.trim().slice(0, 1000) || null,
      agent_instructions: instructions || null,
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
  const cleaned = cleanSettings(input)
  if (!cleaned.ok) return cleaned
  const { settings } = cleaned

  if (!field.standard) {
    // The type can change only while nothing has been entered, so no stored value is ever left in the wrong shape.
    let dataType = field.dataType
    if (input.dataType && input.dataType !== field.dataType) {
      const next = DATA_TYPES.find((type) => type.value === input.dataType)?.value
      if (!next) return { ok: false, error: 'Choose a type.' }
      if (await fieldHasValues(client, fieldId)) return { ok: false, error: 'The type can no longer be changed because values have been entered for this field.' }
      if (field.tracking === 'monthly' && next !== 'number' && next !== 'money' && next !== 'percent') {
        return { ok: false, error: 'A field tracked by month has to stay a number, money or percent.' }
      }
      dataType = next
    }
    const changed = dataType !== field.dataType
    const numeric = dataType === 'number' || dataType === 'money'
    const unit = numeric ? (input.unit ?? '').trim().slice(0, 30) || null : changed ? null : field.unit
    // A pick list's choices are edited on their own (saveFieldOptions) and are left alone here,
    // except when the field has just become a pick list and needs its first ones.
    let options: FieldOption[] | null = dataType === 'picklist' ? field.optionList : null
    if (dataType === 'picklist' && changed) {
      options = normalizeOptions(cleanList(input.options ?? [], 100))
      if (options.length === 0) return { ok: false, error: 'Enter at least one option for the pick list.' }
    }
    await client.query(
      `update field_definitions
       set name = $3, ai_description = $4, agent_instructions = $5,
           when_empty = $6, when_different = $7, manual_override = $8, unit = $9, options = $10::jsonb, data_type = $11
       where id = $1 and org_id = $2`,
      [
        fieldId, orgId, settings.name, settings.ai_description, settings.agent_instructions,
        settings.when_empty, settings.when_different, settings.manual_override, unit, options && options.length > 0 ? JSON.stringify(storedOptions(options)) : null, dataType,
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

/** True once any value, from a person or a source, has been stored for a field in this organization. */
export async function fieldHasValues(client: Queryable, fieldId: string): Promise<boolean> {
  const { rows } = await client.query(
    `select exists (select 1 from field_values where field_id = $1)
         or exists (select 1 from field_source_values where field_id = $1) as used`,
    [fieldId],
  )
  return rows[0]?.used === true
}

/** Puts a standard field back to the Stratios standard: one setting, or all of them. */
export async function resetFieldSettings(client: Queryable, orgId: string, fieldId: string, setting: string | null): Promise<Result> {
  // The choices of a pick list need care: values saved under the organization's own names are renamed back first.
  if (setting === null || setting === 'options') {
    const reset = await resetFieldOptions(client, orgId, fieldId)
    if (!reset.ok) return reset
    if (setting === 'options') return { ok: true }
  }
  if (setting) {
    await client.query('delete from field_settings where org_id = $1 and field_id = $2 and setting = $3', [orgId, fieldId, setting])
  } else {
    await client.query('delete from field_settings where org_id = $1 and field_id = $2', [orgId, fieldId])
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// A pick list's choices
// ---------------------------------------------------------------------------

/** One row of the choices editor. `key` is set for a choice that already exists and empty for a new one. */
export type OptionInput = { key?: string | null; label: string; parent?: string | null; countsAs?: string | null; retired?: boolean }

const lowered = (text: string) => text.trim().toLowerCase()
/** Every name a choice's stored values may carry: its label and the names it used to have. */
const namesOf = (option: FieldOption) => [...new Set([option.label, ...option.aliases].map(lowered))]

/**
 * A condition limiting rows of `v` (field_values or field_source_values) to
 * records whose parent field holds the given choice. Used when two choices of
 * a dependent field share a label and only one of them is meant.
 */
function parentCondition(parent: FieldDefinition, parentNames: string[], params: unknown[]): string {
  params.push(parent.id, parentNames)
  const held = `exists (select 1 from field_values pv where pv.org_id = v.org_id and pv.record_id = v.record_id and pv.field_id = $${params.length - 1}
                 and pv.period is null and pv.row_id is null and lower(pv.value_text) = any($${params.length}::text[]))`
  if (!parent.coreColumn) return held
  return `(${held} or exists (select 1 from ${tableFor(parent.appliesTo)} core where core.id = v.record_id and core.org_id = v.org_id and lower(core.${parent.coreColumn}) = any($${params.length}::text[])))`
}

/** How many of this organization's records hold a choice (as the value, or as what a source says). */
async function optionUse(client: Queryable, orgId: string, field: FieldDefinition, option: FieldOption): Promise<number> {
  const names = namesOf(option)
  const stored = await client.query(
    `select (select count(*) from field_values where org_id = $1 and field_id = $2 and lower(value_text) = any($3::text[]))
          + (select count(*) from field_source_values where org_id = $1 and field_id = $2 and lower(value_text) = any($3::text[])) as used`,
    [orgId, field.id, names],
  )
  let used = Number(stored.rows[0]?.used ?? 0)
  if (field.coreColumn) {
    const core = await client.query(`select count(*) as used from ${tableFor(field.appliesTo)} where org_id = $1 and lower(${field.coreColumn}) = any($2::text[])`, [orgId, names])
    used += Number(core.rows[0]?.used ?? 0)
  }
  return used
}

/** Renames a choice in one organization's stored values, so they read the same as the list. */
async function renameStored(client: Queryable, orgId: string, field: FieldDefinition, from: string[], to: string, parent: { field: FieldDefinition; names: string[] } | null): Promise<void> {
  for (const table of ['field_values', 'field_source_values']) {
    const params: unknown[] = [orgId, field.id, from, to]
    const scope = parent ? ` and ${parentCondition(parent.field, parent.names, params)}` : ''
    await client.query(`update ${table} v set value_text = $4 where v.org_id = $1 and v.field_id = $2 and lower(v.value_text) = any($3::text[]) and v.value_text <> $4${scope}`, params)
  }
  if (field.coreColumn) {
    await client.query(`update ${tableFor(field.appliesTo)} set ${field.coreColumn} = $3 where org_id = $1 and lower(${field.coreColumn}) = any($2::text[]) and ${field.coreColumn} <> $3`, [orgId, from, to])
  }
}

/**
 * Saves a pick list's choices.
 *
 * - `owner` is the organization, or null to change a Stratios standard list
 *   for everyone (inside withStratiosAdmin). An organization's version of a
 *   standard list is stored as one modified setting, like its other changes,
 *   and stops following Stratios updates to the list until it is reset.
 * - A choice keeps its key for good. Renaming one keeps the old name as an
 *   alias and, for an organization, rewrites its stored values to the new name.
 * - A choice that records still hold is not removed but retired: hidden from
 *   new picks, kept where it is. A standard choice can only ever be retired.
 * - On a field that depends on another, each choice may belong to one choice
 *   of that field. A choice an organization adds to a standard list may say
 *   which standard choice it counts as.
 */
export async function saveFieldOptions(client: Queryable, owner: string | null, userId: string, fieldId: string, input: OptionInput[]): Promise<Result<{ kept: string[]; modified: boolean }>> {
  const fields = await listFields(client, owner)
  const field = fields.find((candidate) => candidate.id === fieldId)
  if (!field) return { ok: false, error: 'That field could not be found.' }
  if (field.dataType !== 'picklist') return { ok: false, error: 'Only a pick list has options.' }
  if (!Array.isArray(input)) return { ok: false, error: 'The options could not be read.' }

  const previous = field.optionList
  const previousByKey = new Map(previous.map((option) => [option.key, option]))
  // For an organization's version of a standard list: what Stratios itself lists.
  const standard = owner && field.standard ? (field.modifiedSettings.includes('options') ? normalizeOptions(field.standardValues.options) : previous) : null
  const standardKeys = new Set((standard ?? []).map((option) => option.key))
  const parent = parentFieldOf(fields, field)
  const parentKeys = new Set((parent?.optionList ?? []).map((option) => option.key))

  const taken = new Set<string>([...previousByKey.keys(), ...standardKeys])
  const used = new Set<string>()
  const next: FieldOption[] = []
  for (const row of input.slice(0, MAX_OPTIONS)) {
    const label = String(row?.label ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_OPTION_LABEL)
    if (!label) continue
    const given = typeof row.key === 'string' ? row.key : ''
    const before = given && !used.has(given) ? previousByKey.get(given) ?? null : null
    const key = before ? before.key : given && standardKeys.has(given) && !used.has(given) ? given : uniqueKey(keyFromLabel(label), taken)
    taken.add(key)
    used.add(key)
    const parentKey = parent && typeof row.parent === 'string' && parentKeys.has(row.parent) ? row.parent : null
    const countsAs = standard && !standardKeys.has(key) && typeof row.countsAs === 'string' && standardKeys.has(row.countsAs) ? row.countsAs : null
    const aliases = (before?.aliases ?? []).filter((alias) => lowered(alias) !== lowered(label))
    if (before && lowered(before.label) !== lowered(label) && !aliases.some((alias) => lowered(alias) === lowered(before.label))) aliases.push(before.label)
    next.push({ key, label, parent: parentKey, countsAs, retired: row.retired === true, aliases: aliases.slice(-20) })
  }

  for (const option of next) {
    const twin = next.find((other) => other !== option && lowered(other.label) === lowered(option.label) && (other.parent === option.parent || other.parent === null || option.parent === null))
    if (twin) return { ok: false, error: `"${option.label}" is listed twice${parent ? ` for the same ${parent.name}` : ''}. Each option needs its own name.` }
  }

  // Choices taken off the list: gone when nothing holds them, otherwise kept as retired.
  const kept: string[] = []
  for (const option of previous) {
    if (used.has(option.key)) continue
    if (owner && (await optionUse(client, owner, field, option)) === 0) continue
    next.push({ ...option, retired: true })
    if (!option.retired) kept.push(option.label)
  }
  if (!next.some((option) => !option.retired)) return { ok: false, error: 'A pick list needs at least one option that can be chosen.' }

  // Renamed choices: this organization's stored values take the new name.
  if (owner) {
    for (const option of next) {
      const before = previousByKey.get(option.key)
      if (!before || before.label === option.label) continue
      const shared = previous.some((other) => other.key !== before.key && lowered(other.label) === lowered(before.label))
      const parentOption = parent && before.parent ? parent.optionList.find((candidate) => candidate.key === before.parent) ?? null : null
      // A name two choices shared is only rewritten where the parent says which one was meant.
      if (shared && !parentOption) continue
      await renameStored(client, owner, field, namesOf(before), option.label, shared && parent && parentOption ? { field: parent, names: namesOf(parentOption) } : null)
    }
  }

  const stored = JSON.stringify(storedOptions(next))
  if (!owner) {
    await client.query('update field_definitions set options = $2::jsonb where id = $1 and org_id is null', [fieldId, stored])
    return { ok: true, kept, modified: false }
  }
  if (!field.standard) {
    await client.query('update field_definitions set options = $3::jsonb where id = $1 and org_id = $2', [fieldId, owner, stored])
    return { ok: true, kept, modified: false }
  }
  if (standard && stored === JSON.stringify(storedOptions(standard))) {
    await client.query(`delete from field_settings where org_id = $1 and field_id = $2 and setting = 'options'`, [owner, fieldId])
    return { ok: true, kept, modified: false }
  }
  await client.query(
    `insert into field_settings (org_id, field_id, setting, value, modified_by)
     values ($1, $2, 'options', $3::jsonb, $4)
     on conflict (org_id, field_id, setting)
     do update set value = excluded.value,
                   modified_by = case when field_settings.value is distinct from excluded.value then excluded.modified_by else field_settings.modified_by end,
                   modified_at = case when field_settings.value is distinct from excluded.value then now() else field_settings.modified_at end`,
    [owner, fieldId, stored, userId],
  )
  return { ok: true, kept, modified: true }
}

/** Reads the rows the options editor sends, trusting none of it. */
export function readOptionRows(raw: unknown): OptionInput[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 300).map((row) => {
    const entry = (row ?? {}) as Record<string, unknown>
    return {
      key: typeof entry.key === 'string' ? entry.key.slice(0, 80) : null,
      label: String(entry.label ?? '').slice(0, 300),
      parent: typeof entry.parent === 'string' ? entry.parent.slice(0, 80) : null,
      countsAs: typeof entry.countsAs === 'string' ? entry.countsAs.slice(0, 80) : null,
      retired: entry.retired === true,
    }
  })
}

/** What to say after a list was saved, naming any options kept as retired because records hold them. */
export function optionsMessage(kept: string[], standard: boolean): string {
  const base = standard ? 'Saved. The list is live for every organization that has not made its own version.' : 'Options saved.'
  if (kept.length === 0) return base
  return `${base} ${kept.length === 1 ? `"${kept[0]}" is` : `${kept.map((label) => `"${label}"`).join(', ')} are`} still held by records, so ${kept.length === 1 ? 'it was' : 'they were'} retired instead of removed.`
}

/**
 * Puts an organization's version of a standard pick list back to the Stratios
 * list. Values saved under the organization's own names for standard choices
 * are renamed back. It is refused while records hold a choice the
 * organization added, because the standard list has no place for them.
 */
export async function resetFieldOptions(client: Queryable, orgId: string, fieldId: string): Promise<Result> {
  const fields = await listFields(client, orgId)
  const field = fields.find((candidate) => candidate.id === fieldId)
  if (!field || !field.standard || !field.modifiedSettings.includes('options')) return { ok: true }
  const standard = normalizeOptions(field.standardValues.options)
  const standardKeys = new Set(standard.map((option) => option.key))
  const stranded: string[] = []
  for (const option of field.optionList) {
    if (!standardKeys.has(option.key) && (await optionUse(client, orgId, field, option)) > 0) stranded.push(option.label)
  }
  if (stranded.length > 0) {
    return { ok: false, error: `Records still use ${stranded.length === 1 ? 'an option' : 'options'} you added (${stranded.join(', ')}). Change those records first, then reset.` }
  }
  const parent = parentFieldOf(fields, field)
  for (const option of field.optionList) {
    const original = standard.find((candidate) => candidate.key === option.key)
    if (!original || original.label === option.label) continue
    const shared = field.optionList.some((other) => other.key !== option.key && lowered(other.label) === lowered(option.label))
    const parentOption = parent && option.parent ? parent.optionList.find((candidate) => candidate.key === option.parent) ?? null : null
    if (shared && !parentOption) continue
    await renameStored(client, orgId, field, namesOf(option), original.label, shared && parent && parentOption ? { field: parent, names: namesOf(parentOption) } : null)
  }
  await client.query(`delete from field_settings where org_id = $1 and field_id = $2 and setting = 'options'`, [orgId, fieldId])
  return { ok: true }
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

async function freeLayoutKey(client: Queryable, orgId: string | null, table: 'screens' | 'sections' | 'field_lists', name: string, appliesTo: RecordType | null): Promise<string> {
  // For a standard screen, section or list (no owner), check every organization's keys.
  const scope = orgId ? '(org_id is null or org_id = $1)' : '($1::text is null)'
  const { rows } = appliesTo
    ? await client.query(`select key from ${table} where ${scope} and applies_to = $2`, [orgId, appliesTo])
    : await client.query(`select key from ${table} where ${scope}`, [orgId])
  return firstFree(camelKey(name, table === 'screens' ? 'screen' : table === 'sections' ? 'section' : 'list'), new Set(rows.map((row) => String(row.key))))
}

function layoutName(raw: string): Result<{ name: string }> {
  const name = raw.trim()
  if (!name) return { ok: false, error: 'Enter a name.' }
  if (name.length > 60) return { ok: false, error: 'The name is too long.' }
  return { ok: true, name }
}

/** Adds a screen (a tab on the asset page) after the existing ones. */
export async function createScreen(client: Queryable, orgId: string | null, rawName: string): Promise<Result<{ id: string }>> {
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
  orgId: string | null,
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
  orgId: string | null,
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
  orgId: string | null,
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

// ---------------------------------------------------------------------------
// The master library: Stratios standard fields, changed for every organization
// ---------------------------------------------------------------------------

/**
 * Changes a Stratios standard field itself. The change is live for every
 * organization at once, except for any setting an organization has modified.
 */
export async function saveStandardField(client: Queryable, fieldId: string, input: FieldSettingsInput): Promise<Result> {
  const field = (await listFields(client, null)).find((candidate) => candidate.id === fieldId)
  if (!field) return { ok: false, error: 'That standard field could not be found.' }
  const cleaned = cleanSettings(input)
  if (!cleaned.ok) return cleaned
  const { settings } = cleaned
  if (field.coreColumn === 'name' && settings.name.length === 0) return { ok: false, error: 'The field needs a name.' }

  const numeric = field.dataType === 'number' || field.dataType === 'money'
  const unit = numeric ? (input.unit ?? '').trim().slice(0, 30) || null : field.unit
  await client.query(
    `update field_definitions
     set name = $2, ai_description = $3, agent_instructions = $4,
         when_empty = $5, when_different = $6, manual_override = $7, unit = $8
     where id = $1 and org_id is null`,
    [
      fieldId, settings.name, settings.ai_description, settings.agent_instructions,
      settings.when_empty, settings.when_different, settings.manual_override, unit,
    ],
  )
  return { ok: true }
}

/** Moves a standard field to another standard section (or to none) for every organization that hasn't placed it itself. */
export async function placeStandardField(client: Queryable, fieldId: string, sectionId: string | null): Promise<Result> {
  const field = (await listFields(client, null)).find((candidate) => candidate.id === fieldId)
  if (!field) return { ok: false, error: 'That standard field could not be found.' }
  if (field.listId) return { ok: false, error: 'A list column stays with its list.' }
  if (sectionId) {
    const section = await client.query(
      `select name from sections where id = $1 and org_id is null and applies_to = $2 and display_style <> 'list'`,
      [sectionId, field.appliesTo],
    )
    if (section.rows.length === 0) return { ok: false, error: 'That standard section could not be found.' }
    const already = await client.query('select 1 as found from section_fields where org_id is null and field_id = $1 and section_id = $2', [fieldId, sectionId])
    if (already.rows.length > 0) return { ok: true }
    await client.query('delete from section_fields where org_id is null and field_id = $1', [fieldId])
    const order = await client.query('select coalesce(max(position), 0) + 10 as next from section_fields where org_id is null and section_id = $1', [sectionId])
    await client.query('insert into section_fields (org_id, section_id, field_id, position) values (null, $1, $2, $3)', [sectionId, fieldId, Number(order.rows[0].next)])
    await client.query('update field_definitions set group_name = $2 where id = $1 and org_id is null', [fieldId, section.rows[0].name])
  } else {
    await client.query('delete from section_fields where org_id is null and field_id = $1', [fieldId])
    await client.query(`update field_definitions set group_name = 'Other Fields' where id = $1 and org_id is null`, [fieldId])
  }
  return { ok: true }
}

/** Retires a standard field: hidden for every organization, with values and history kept. */
export async function retireStandardField(client: Queryable, fieldId: string): Promise<Result> {
  const { rows } = await client.query(
    'update field_definitions set retired_at = now() where id = $1 and org_id is null and retired_at is null and core_column is null returning id::text as id',
    [fieldId],
  )
  if (rows.length === 0) return { ok: false, error: 'That standard field cannot be retired.' }
  return { ok: true }
}

/** For each standard field, how many organizations have modified at least one of its settings. */
export async function countCustomizations(client: Queryable): Promise<Map<string, number>> {
  const { rows } = await client.query('select field_id::text as field_id, count(distinct org_id)::int as orgs from field_settings group by field_id')
  return new Map(rows.map((row) => [String(row.field_id), Number(row.orgs)]))
}

export type { FieldDefinition }
