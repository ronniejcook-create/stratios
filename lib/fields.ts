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
import { belongsTo, findOption, labelsOf, normalizeOptions, parentKeysOf, pickable, type FieldOption } from './optionLists'
import { recordExists, tableFor, type Queryable, type RecordType } from './records'

export type FieldDefinition = {
  id: string
  key: string
  name: string
  appliesTo: RecordType
  dataType: DataType
  unit: string | null
  /** A pick list's choices that can be picked now, as labels. The full choices are in `optionList`. */
  options: string[] | null
  /** A pick list's choices in full: permanent key, label, parent, retired ones included. Empty for other types. */
  optionList: FieldOption[]
  /** Labels of retired choices, and old names of renamed ones; see FieldShape. */
  retiredOptions: string[]
  optionAliases: Record<string, string>
  /** The key of the field (on the same kind of record) whose value decides which choices apply, as Property Subtype depends on Property Type. */
  dependsOn: string | null
  /** For a field that depends on another: that field's choices, key to label, for naming the groups. */
  parentLabels: Record<string, string>
  tracking: 'single' | 'monthly'
  rollup: 'sum' | 'average' | 'last' | 'direct' | null
  calculated: boolean
  formula: string | null
  coreColumn: 'name' | 'property_type' | null
  groupName: string
  sortOrder: number
  aiDescription: string | null
  otherNames: string[]
  extractionHints: string | null
  sourcePriority: string[]
  /** Markdown the agents read like a skill: other names, where to find the value, which source to prefer, how to work it out. */
  agentInstructions: string | null
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
  /** The Stratios standard value of each changed setting, for comparing and resetting. */
  standardValues: Record<string, unknown>
}

// The settings an organization may change on a standard field. Anything not
// listed here always follows the Stratios standard.
export const OVERRIDABLE = {
  name: 'name',
  ai_description: 'aiDescription',
  agent_instructions: 'agentInstructions',
  when_empty: 'whenEmpty',
  when_different: 'whenDifferent',
  manual_override: 'manualOverride',
} as const satisfies Record<string, keyof FieldDefinition>
export type OverridableSetting = keyof typeof OVERRIDABLE

/**
 * Every field this organization can use: the Stratios standard fields with
 * the organization's own changes applied, plus fields it added itself.
 * Pass null for the organization to get the Stratios standard fields alone,
 * exactly as Stratios defines them (used by the Master Library).
 */
export async function listFields(client: Queryable, orgId: string | null): Promise<FieldDefinition[]> {
  const definitions = await client.query(
    `select id::text as id, org_id, key, name, applies_to, data_type, unit, options, tracking, rollup, calculated, formula,
            core_column, group_name, sort_order, ai_description, to_json(other_names) as other_names, extraction_hints,
            to_json(source_priority) as source_priority, when_empty, when_different, manual_override,
            to_jsonb(field_definitions) ->> 'agent_instructions' as agent_instructions,
            to_jsonb(field_definitions) ->> 'depends_on' as depends_on,
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
    options: null,
    optionList: [],
    retiredOptions: [],
    optionAliases: {},
    dependsOn: row.depends_on ?? null,
    parentLabels: {},
    tracking: row.tracking,
    rollup: row.rollup ?? null,
    calculated: Boolean(row.calculated),
    formula: row.formula ?? null,
    coreColumn: row.core_column ?? null,
    groupName: row.group_name,
    sortOrder: Number(row.sort_order),
    aiDescription: row.ai_description ?? null,
    otherNames: (row.other_names as string[]) ?? [],
    extractionHints: row.extraction_hints ?? null,
    sourcePriority: (row.source_priority as string[]) ?? [],
    agentInstructions: row.agent_instructions ?? null,
    whenEmpty: row.when_empty,
    whenDifferent: row.when_different,
    manualOverride: row.manual_override,
    listId: row.list_id ?? null,
    defaultValue: row.default_value ?? null,
    standard: row.org_id === null,
    modifiedSettings: [],
    standardValues: {},
  }))

  const byId = new Map(fields.map((field) => [field.id, field]))
  // A pick list's choices as stored: the field's own, or the organization's version of a standard field's.
  const storedLists = new Map<string, unknown>(definitions.rows.map((row) => [row.id as string, row.options]))
  for (const row of settings.rows) {
    const field = byId.get(row.field_id)
    if (field && field.standard && row.setting === 'options' && Array.isArray(row.value)) {
      field.standardValues.options = storedLists.get(field.id) ?? null
      storedLists.set(field.id, row.value)
      field.modifiedSettings.push('options')
      continue
    }
    const property = OVERRIDABLE[row.setting as OverridableSetting] as keyof FieldDefinition | undefined
    // Only standard fields are customized this way; an organization's own fields are edited directly.
    if (!field || !field.standard || !property || row.value === undefined) continue
    field.standardValues[row.setting] = field[property]
    ;(field as Record<string, unknown>)[property] = row.value
    field.modifiedSettings.push(row.setting)
  }
  for (const field of fields) {
    if (field.dataType !== 'picklist') continue
    applyOptionList(field, normalizeOptions(storedLists.get(field.id)))
  }
  for (const field of fields) {
    const parent = parentFieldOf(fields, field)
    if (parent) field.parentLabels = Object.fromEntries(parent.optionList.map((option) => [option.key, option.label]))
  }
  return fields.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

/** Sets a pick list field's choices and everything worked out from them. */
export function applyOptionList(field: FieldDefinition, optionList: FieldOption[]): void {
  field.optionList = optionList
  const active = labelsOf(optionList.filter((option) => !option.retired))
  field.options = active.length > 0 || optionList.length > 0 ? active : null
  field.retiredOptions = labelsOf(optionList.filter((option) => option.retired))
  field.optionAliases = {}
  for (const option of optionList) {
    for (const alias of option.aliases) {
      const old = alias.trim().toLowerCase()
      // A name another choice now carries is that choice's, not an old name of this one.
      if (old && !optionList.some((other) => other.label.trim().toLowerCase() === old)) field.optionAliases[old] ??= option.label
    }
  }
}

/** The field another depends on: same kind of record, the key named in `dependsOn`, itself a pick list. */
export function parentFieldOf(fields: FieldDefinition[], field: FieldDefinition): FieldDefinition | null {
  if (!field.dependsOn) return null
  return fields.find((candidate) => candidate.key === field.dependsOn && candidate.appliesTo === field.appliesTo && candidate.dataType === 'picklist' && !candidate.listId) ?? null
}

/** What a single-value field holds on a record right now, as text (its fixed column when it has no stored value yet). */
async function currentText(client: Queryable, orgId: string, field: FieldDefinition, recordType: RecordType, recordId: string): Promise<string | null> {
  const stored = await client.query(
    `select value_text from field_values
     where org_id = $1 and record_type = $2 and record_id = $3 and field_id = $4 and period is null and row_id is null and status = 'approved'`,
    [orgId, recordType, recordId, field.id],
  )
  if (stored.rows.length > 0) return stored.rows[0].value_text ?? null
  if (!field.coreColumn) return null
  const core = await client.query(`select ${field.coreColumn} as value from ${tableFor(recordType)} where id = $1 and org_id = $2`, [recordId, orgId])
  return core.rows[0]?.value ?? null
}

/**
 * For a field whose choices depend on another field: why `label` can't be
 * picked for this record, or null when it can. "Medical Office" is refused on
 * a Retail property; nothing can be picked until the parent has a value.
 */
export async function dependentProblem(client: Queryable, orgId: string, fields: FieldDefinition[], field: FieldDefinition, recordType: RecordType, recordId: string, label: string): Promise<string | null> {
  const parent = parentFieldOf(fields, field)
  if (!parent) return null
  const parentLabel = await currentText(client, orgId, parent, recordType, recordId)
  const parentOption = findOption(parent.optionList, parentLabel)
  if (!parentLabel || !parentOption) return `Set ${parent.name} first; the choices for ${field.name} depend on it.`
  const allowed = pickable(field.optionList, parentKeysOf(parentOption))
  if (allowed.some((option) => option.label.toLowerCase() === label.trim().toLowerCase())) return null
  return allowed.length > 0
    ? `"${label}" is not a choice for ${parentOption.label}. Choose one of: ${allowed.map((option) => option.label).join(', ')}.`
    : `${field.name} has no choices for ${parentOption.label}.`
}

/**
 * After a field's value changed on a record: empties any field that depends
 * on it and now holds a choice that no longer fits (a subtype left over from
 * the old property type). The emptying is in the dependent field's history.
 */
export async function clearMisfitDependents(client: Queryable, orgId: string, userId: string, fields: FieldDefinition[], parent: FieldDefinition, recordType: RecordType, recordId: string): Promise<void> {
  const dependents = fields.filter((candidate) => candidate.dependsOn === parent.key && candidate.appliesTo === parent.appliesTo && candidate.dataType === 'picklist' && !candidate.listId && candidate.id !== parent.id)
  if (dependents.length === 0) return
  const parentLabel = await currentText(client, orgId, parent, recordType, recordId)
  const parentOption = findOption(parent.optionList, parentLabel)
  for (const dependent of dependents) {
    const held = await currentText(client, orgId, dependent, recordType, recordId)
    if (!held) continue
    const option = findOption(dependent.optionList, held, parentKeysOf(parentOption))
    if (parentOption && option && belongsTo(option, parentKeysOf(parentOption))) continue
    const note = parentLabel ? `Emptied because ${parent.name} changed to ${parentOption?.label ?? parentLabel}` : `Emptied because ${parent.name} was emptied`
    const cleared = await saveManualValue(client, orgId, userId, { recordType, recordId, fieldId: dependent.id, raw: '', note })
    if (!cleared.ok) console.error(`Emptying ${dependent.key} after ${parent.key} changed failed: ${cleared.error}`)
  }
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
  /**
   * Set when the value is one a new record starts with (its name, its type).
   * A starting value always gets a "Set to ..." entry in its history, so the
   * history says where the value first came from and who brought it in.
   */
  starting?: boolean
  /**
   * Set when the value was read from a document rather than typed: it is then
   * recorded as coming from Documents, not Manual Entry, and is not treated
   * as a hand-entered value that later sources must leave alone.
   */
  fromDocument?: { id: string; name: string } | null
  /**
   * Set when the value was looked up from a public source (for example a
   * property's flood zone from FEMA): it is recorded as Market Data with this
   * note. A value a person entered by hand is left alone when the field says
   * hand-entered values stay; what the source says is still kept beside it.
   */
  fromLookup?: { note: string } | null
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
  const fromLookup = input.fromDocument ? null : input.fromLookup ?? null

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

  const fromDocument = input.fromDocument ?? null
  const source = fromDocument ? 'documents' : fromLookup ? 'marketData' : 'manual'
  const note = input.note?.trim() ? input.note.trim().slice(0, 2000) : fromDocument ? `From "${fromDocument.name}"`.slice(0, 2000) : fromLookup ? fromLookup.note.trim().slice(0, 2000) || null : null
  const table = tableFor(input.recordType)

  // Lock the golden row (if there is one) so two saves can't cross.
  const existing = await client.query(
    `select id::text as id, ${VALUE_COLUMNS}, manual_override
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

  // A retired choice stays on records that hold it, but can't be picked afresh.
  if (field.dataType === 'picklist' && next.text !== null && !sameValue(current, next)) {
    const label = next.text.toLowerCase()
    if (field.retiredOptions.some((option) => option.toLowerCase() === label) && !(field.options ?? []).some((option) => option.toLowerCase() === label)) {
      return { ok: false, error: `"${next.text}" has been retired and can no longer be chosen for ${field.name}.` }
    }
  }

  // A choice that depends on another field has to fit what that field holds (a subtype of the property's type).
  if (field.dependsOn && field.dataType === 'picklist' && !rowId && next.text !== null && !sameValue(current, next)) {
    const problem = await dependentProblem(client, orgId, fields, field, input.recordType, input.recordId, next.text)
    if (problem) return { ok: false, error: problem }
  }

  // What this source says is always recorded, whether or not it changes the golden record.
  await client.query(
    `delete from field_source_values
     where org_id = $1 and record_type = $2 and record_id = $3 and field_id = $4 and source_type = $7
       and period is not distinct from $5::date and row_id is not distinct from $6::uuid`,
    [orgId, input.recordType, input.recordId, field.id, period, rowId, source],
  )
  if (!isEmptyValue(next)) {
    if (fromDocument) {
      await client.query(
        `insert into field_source_values
           (org_id, record_type, record_id, field_id, period, source_type, value_text, value_number, value_date, value_bool, received_by, row_id, document_id)
         values ($1, $2, $3, $4, $5::date, 'documents', $6, $7::numeric, $8::date, $9::boolean, $10, $11::uuid, $12::uuid)`,
        [orgId, input.recordType, input.recordId, field.id, period, next.text, next.number, next.date, next.bool, userId, rowId, fromDocument.id],
      )
    } else {
      await client.query(
        `insert into field_source_values
           (org_id, record_type, record_id, field_id, period, source_type, value_text, value_number, value_date, value_bool, received_by, row_id)
         values ($1, $2, $3, $4, $5::date, $12, $6, $7::numeric, $8::date, $9::boolean, $10, $11::uuid)`,
        [orgId, input.recordType, input.recordId, field.id, period, next.text, next.number, next.date, next.bool, userId, rowId, source],
      )
    }
  }

  // A looked-up value never replaces one a person entered by hand on a field whose hand-entered values stay.
  if (fromLookup && existing.rows.length > 0 && existing.rows[0].manual_override === true && field.manualOverride === 'stays' && !isEmptyValue(current)) {
    return { ok: true, changed: false }
  }

  const changed = !sameValue(current, next)
  if (!changed && existing.rows.length > 0) return { ok: true, changed: false }

  if (existing.rows.length > 0) {
    await client.query(
      `update field_values
       set value_text = $2, value_number = $3::numeric, value_date = $4::date, value_bool = $5::boolean,
           source_type = $9, manual_override = $10::boolean, status = 'approved', note = $6, updated_by = $7, updated_at = now()
       where id = $1 and org_id = $8`,
      [existing.rows[0].id, next.text, next.number, next.date, next.bool, note, userId, orgId, source, source === 'manual'],
    )
  } else if (!isEmptyValue(next)) {
    await client.query(
      `insert into field_values
         (org_id, record_type, record_id, field_id, period, value_text, value_number, value_date, value_bool,
          source_type, manual_override, status, note, updated_by, row_id)
       values ($1, $2, $3, $4, $5::date, $6, $7::numeric, $8::date, $9::boolean, $13, $14::boolean, 'approved', $10, $11, $12::uuid)`,
      [orgId, input.recordType, input.recordId, field.id, period, next.text, next.number, next.date, next.bool, note, userId, rowId, source, source === 'manual'],
    )
  }
  // A record's first value for a field that also lives in a fixed column (its name, its type) equals that
  // column, so it is "unchanged"; as a starting value it still gets its first history entry, from empty.
  const firstEntry = input.starting === true && existing.rows.length === 0 && !isEmptyValue(next)
  if (!changed && !firstEntry) return { ok: true, changed: false }
  if (firstEntry) current = { ...EMPTY_VALUE }

  await client.query(
    `insert into field_value_history
       (org_id, record_type, record_id, field_id, period,
        old_text, old_number, old_date, old_bool, new_text, new_number, new_date, new_bool, source_type, note, changed_by, row_id)
     values ($1, $2, $3, $4, $5::date, $6, $7::numeric, $8::date, $9::boolean, $10, $11::numeric, $12::date, $13::boolean, $17, $14, $15, $16::uuid)`,
    [
      orgId, input.recordType, input.recordId, field.id, period,
      current.text, current.number, current.date, current.bool,
      next.text, next.number, next.date, next.bool, note, userId, rowId, source,
    ],
  )

  if (field.coreColumn) {
    await client.query(`update ${table} set ${field.coreColumn} = $1 where id = $2 and org_id = $3`, [next.text, input.recordId, orgId])
  }
  // Fields whose choices depend on this one may now hold a choice that no longer fits.
  if (changed && field.dataType === 'picklist' && !rowId) await clearMisfitDependents(client, orgId, userId, fields, field, input.recordType, input.recordId)
  return { ok: true, changed }
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
