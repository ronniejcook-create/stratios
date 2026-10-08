// The field dictionary and field values.
//
// - field_definitions: what a field is (Stratios standard, or added by an organization)
// - field_settings:    an organization's changes to a field, one setting at a time
// - field_values:      the golden record, one row per record, field and period
// - field_value_history: a row each time a golden value changes
// - field_source_values: what each source type currently says
//
// Every function takes the database client of a transaction already scoped to
// one organization (see withOrg in lib/db.ts).

import { EMPTY_VALUE, isEmptyValue, monthToPeriod, parseInput, sameValue, type DataType, type StoredValue } from './fieldFormat'
import { recordExists, tableFor, type Queryable, type RecordType } from './records'

export type FieldDefinition = {
  id: string
  key: string
  name: string
  appliesTo: RecordType
  dataType: DataType
  unit: string | null
  options: string[] | null
  tracking: 'single' | 'monthly'
  rollup: 'sum' | 'average' | 'last' | 'direct' | null
  calculated: boolean
  formula: string | null
  coreColumn: 'name' | 'property_type' | null
  groupName: string
  sortOrder: number
  aiDescription: string | null
  otherNames: string[]
  sourcePriority: string[]
  whenEmpty: 'fill' | 'ask'
  whenDifferent: 'ask' | 'replace' | 'never'
  manualOverride: 'stays' | 'replaceable'
  /** The list this field is a column of, or null for an ordinary field. */
  listId: string | null
  /** What a new list entry starts with. */
  defaultValue: 'today' | 'currentUser' | null
  /** True for a Stratios standard field, false for one the organization added. */
  standard: boolean
  /** Settings this organization has changed on a standard field. */
  modifiedSettings: string[]
}

// The settings an organization may change on a standard field. Anything not
// listed here always follows the Stratios standard.
const OVERRIDABLE: Record<string, keyof FieldDefinition> = {
  name: 'name',
  group_name: 'groupName',
  sort_order: 'sortOrder',
  ai_description: 'aiDescription',
  other_names: 'otherNames',
  source_priority: 'sourcePriority',
  when_empty: 'whenEmpty',
  when_different: 'whenDifferent',
  manual_override: 'manualOverride',
  formula: 'formula',
}

/**
 * Every field this organization can use: the Stratios standard fields with
 * the organization's own changes applied, plus fields it added itself.
 */
export async function listFields(client: Queryable, orgId: string): Promise<FieldDefinition[]> {
  const definitions = await client.query(
    `select id::text as id, org_id, key, name, applies_to, data_type, unit, options, tracking, rollup, calculated, formula,
            core_column, group_name, sort_order, ai_description, to_json(other_names) as other_names,
            to_json(source_priority) as source_priority, when_empty, when_different, manual_override,
            list_id::text as list_id, default_value
     from field_definitions
     where (org_id is null or org_id = $1) and retired_at is null
     order by sort_order, name`,
    [orgId],
  )
  const settings = await client.query('select field_id::text as field_id, setting, value from field_settings where org_id = $1', [orgId])

  const fields: FieldDefinition[] = definitions.rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    appliesTo: row.applies_to,
    dataType: row.data_type,
    unit: row.unit ?? null,
    options: Array.isArray(row.options) ? (row.options as string[]) : null,
    tracking: row.tracking,
    rollup: row.rollup ?? null,
    calculated: Boolean(row.calculated),
    formula: row.formula ?? null,
    coreColumn: row.core_column ?? null,
    groupName: row.group_name,
    sortOrder: Number(row.sort_order),
    aiDescription: row.ai_description ?? null,
    otherNames: (row.other_names as string[]) ?? [],
    sourcePriority: (row.source_priority as string[]) ?? [],
    whenEmpty: row.when_empty,
    whenDifferent: row.when_different,
    manualOverride: row.manual_override,
    listId: row.list_id ?? null,
    defaultValue: row.default_value ?? null,
    standard: row.org_id === null,
    modifiedSettings: [],
  }))

  const byId = new Map(fields.map((field) => [field.id, field]))
  for (const row of settings.rows) {
    const field = byId.get(row.field_id)
    const property = OVERRIDABLE[row.setting as string]
    if (!field || !property || row.value === null || row.value === undefined) continue
    ;(field as Record<string, unknown>)[property] = row.value
    field.modifiedSettings.push(row.setting)
  }
  return fields.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

export type FieldValue = StoredValue & {
  fieldId: string
  recordId: string
  period: string | null
  sourceType: string
  manualOverride: boolean
  updatedAt: string
}

const VALUE_COLUMNS = `value_text as text, value_number::float8 as number, value_date::text as date, value_bool as bool`

/** Golden-record values for a set of records (all periods). List rows are read separately, in lib/lists.ts. */
export async function listValues(client: Queryable, orgId: string, recordIds: string[]): Promise<FieldValue[]> {
  if (recordIds.length === 0) return []
  const { rows } = await client.query(
    `select field_id::text as field_id, record_id::text as record_id, period::text as period, ${VALUE_COLUMNS},
            source_type, manual_override,
            to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
     from field_values
     where org_id = $1 and record_id = any($2::uuid[]) and status = 'approved' and row_id is null
     order by period desc nulls last`,
    [orgId, recordIds],
  )
  return rows.map((row) => ({
    fieldId: row.field_id,
    recordId: row.record_id,
    period: row.period ?? null,
    text: row.text ?? null,
    number: row.number === null || row.number === undefined ? null : Number(row.number),
    date: row.date ?? null,
    bool: row.bool ?? null,
    sourceType: row.source_type,
    manualOverride: Boolean(row.manual_override),
    updatedAt: row.updated_at,
  }))
}

export type SaveInput = {
  recordType: RecordType
  recordId: string
  fieldId: string
  /** "YYYY-MM" for a monthly field; ignored for single-value fields. */
  month?: string | null
  /** What the person typed. Empty clears the value. */
  raw: string
  note?: string | null
  /** The list row this value belongs to; required for a list's column, otherwise left out. */
  rowId?: string | null
}

export type SaveResult = { ok: true; changed: boolean } | { ok: false; error: string }

/**
 * Saves a value a person entered by hand.
 *
 * - If it matches the golden record, nothing changes and no history is added;
 *   the Manual Entry source value is still recorded.
 * - If it differs, the golden record is updated, one history row is added,
 *   and the value is marked as a manual override.
 */
export async function saveManualValue(client: Queryable, orgId: string, userId: string, input: SaveInput): Promise<SaveResult> {
  if (!(await recordExists(client, orgId, input.recordType, input.recordId))) return { ok: false, error: 'That record could not be found.' }

  const fields = await listFields(client, orgId)
  const field = fields.find((candidate) => candidate.id === input.fieldId)
  if (!field || field.appliesTo !== input.recordType) return { ok: false, error: 'That field could not be found.' }
  if (field.calculated) return { ok: false, error: `${field.name} is calculated, so it can't be entered by hand.` }

  // A list's column needs a row of that list on this record; any other field must not have one.
  const rowId = input.rowId ?? null
  if (field.listId) {
    const row = rowId
      ? await client.query(
          `select 1 as found from field_list_rows
           where id = $1 and org_id = $2 and list_id = $3 and record_type = $4 and record_id = $5 and removed_at is null`,
          [rowId, orgId, field.listId, input.recordType, input.recordId],
        )
      : { rows: [] }
    if (row.rows.length === 0) return { ok: false, error: 'That entry could not be found.' }
  } else if (rowId) {
    return { ok: false, error: 'That field could not be found.' }
  }

  let period: string | null = null
  if (field.tracking === 'monthly') {
    period = monthToPeriod(input.month ?? '')
    if (!period) return { ok: false, error: 'Choose the month this value is for.' }
  }

  const parsed = parseInput(field, input.raw)
  if (!parsed.ok) return parsed
  const next = parsed.value
  if (field.coreColumn === 'name' && isEmptyValue(next)) return { ok: false, error: `${field.name} can't be empty.` }

  const note = input.note?.trim() ? input.note.trim().slice(0, 2000) : null
  const table = tableFor(input.recordType)

  // Lock the golden row (if there is one) so two saves can't cross.
  const existing = await client.query(
    `select id::text as id, ${VALUE_COLUMNS}
     from field_values
     where org_id = $1 and record_type = $2 and record_id = $3 and field_id = $4
       and period is not distinct from $5::date and row_id is not distinct from $6::uuid
     for update`,
    [orgId, input.recordType, input.recordId, field.id, period, rowId],
  )
  let current: StoredValue = { ...EMPTY_VALUE }
  if (existing.rows.length > 0) {
    const row = existing.rows[0]
    current = {
      text: row.text ?? null,
      number: row.number === null || row.number === undefined ? null : Number(row.number),
      date: row.date ?? null,
      bool: row.bool ?? null,
    }
  } else if (field.coreColumn) {
    // Name and property type also live in a fixed column; start from that.
    const core = await client.query(`select ${field.coreColumn} as value from ${table} where id = $1 and org_id = $2`, [input.recordId, orgId])
    current = { ...EMPTY_VALUE, text: core.rows[0]?.value ?? null }
  }

  // What Manual Entry says is always recorded, whether or not it changes the golden record.
  await client.query(
    `delete from field_source_values
     where org_id = $1 and record_type = $2 and record_id = $3 and field_id = $4 and source_type = 'manual'
       and period is not distinct from $5::date and row_id is not distinct from $6::uuid`,
    [orgId, input.recordType, input.recordId, field.id, period, rowId],
  )
  if (!isEmptyValue(next)) {
    await client.query(
      `insert into field_source_values
         (org_id, record_type, record_id, field_id, period, source_type, value_text, value_number, value_date, value_bool, received_by, row_id)
       values ($1, $2, $3, $4, $5::date, 'manual', $6, $7::numeric, $8::date, $9::boolean, $10, $11::uuid)`,
      [orgId, input.recordType, input.recordId, field.id, period, next.text, next.number, next.date, next.bool, userId, rowId],
    )
  }

  const changed = !sameValue(current, next)
  if (!changed && existing.rows.length > 0) return { ok: true, changed: false }

  if (existing.rows.length > 0) {
    await client.query(
      `update field_values
       set value_text = $2, value_number = $3::numeric, value_date = $4::date, value_bool = $5::boolean,
           source_type = 'manual', manual_override = true, status = 'approved', note = $6, updated_by = $7, updated_at = now()
       where id = $1 and org_id = $8`,
      [existing.rows[0].id, next.text, next.number, next.date, next.bool, note, userId, orgId],
    )
  } else if (!isEmptyValue(next)) {
    await client.query(
      `insert into field_values
         (org_id, record_type, record_id, field_id, period, value_text, value_number, value_date, value_bool,
          source_type, manual_override, status, note, updated_by, row_id)
       values ($1, $2, $3, $4, $5::date, $6, $7::numeric, $8::date, $9::boolean, 'manual', true, 'approved', $10, $11, $12::uuid)`,
      [orgId, input.recordType, input.recordId, field.id, period, next.text, next.number, next.date, next.bool, note, userId, rowId],
    )
  }
  if (!changed) return { ok: true, changed: false }

  await client.query(
    `insert into field_value_history
       (org_id, record_type, record_id, field_id, period,
        old_text, old_number, old_date, old_bool, new_text, new_number, new_date, new_bool, source_type, note, changed_by, row_id)
     values ($1, $2, $3, $4, $5::date, $6, $7::numeric, $8::date, $9::boolean, $10, $11::numeric, $12::date, $13::boolean, 'manual', $14, $15, $16::uuid)`,
    [
      orgId, input.recordType, input.recordId, field.id, period,
      current.text, current.number, current.date, current.bool,
      next.text, next.number, next.date, next.bool, note, userId, rowId,
    ],
  )

  if (field.coreColumn) {
    await client.query(`update ${table} set ${field.coreColumn} = $1 where id = $2 and org_id = $3`, [next.text, input.recordId, orgId])
  }
  return { ok: true, changed: true }
}

export type HistoryEntry = {
  period: string | null
  oldValue: StoredValue
  newValue: StoredValue
  sourceType: string
  sourceName: string
  note: string | null
  changedBy: string
  changedAt: string
}

/** The most recent changes to one field on one record, newest first. */
export async function listHistory(
  client: Queryable,
  orgId: string,
  recordType: RecordType,
  recordId: string,
  fieldId: string,
  rowId: string | null = null,
): Promise<HistoryEntry[]> {
  const { rows } = await client.query(
    `select h.period::text as period,
            h.old_text, h.old_number::float8 as old_number, h.old_date::text as old_date, h.old_bool,
            h.new_text, h.new_number::float8 as new_number, h.new_date::text as new_date, h.new_bool,
            h.source_type, s.name as source_name, h.note, h.changed_by,
            to_char(h.changed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as changed_at
     from field_value_history h
     join source_types s on s.key = h.source_type
     where h.org_id = $1 and h.record_type = $2 and h.record_id = $3 and h.field_id = $4
       and h.row_id is not distinct from $5::uuid
     order by h.changed_at desc, h.id
     limit 50`,
    [orgId, recordType, recordId, fieldId, rowId],
  )
  const num = (value: unknown) => (value === null || value === undefined ? null : Number(value))
  return rows.map((row) => ({
    period: row.period ?? null,
    oldValue: { text: row.old_text ?? null, number: num(row.old_number), date: row.old_date ?? null, bool: row.old_bool ?? null },
    newValue: { text: row.new_text ?? null, number: num(row.new_number), date: row.new_date ?? null, bool: row.new_bool ?? null },
    sourceType: row.source_type,
    sourceName: row.source_name,
    note: row.note ?? null,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
  }))
}

export type SourceType = { key: string; name: string }

export async function listSourceTypes(client: Queryable): Promise<SourceType[]> {
  const { rows } = await client.query('select key, name from source_types order by sort_order')
  return rows.map((row) => ({ key: row.key, name: row.name }))
}
