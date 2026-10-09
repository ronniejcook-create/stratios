// Lists: fields grouped by row, such as Comments or Critical Dates.
//
// A list's columns are ordinary fields whose listId points at the list. Each
// entry is a row in field_list_rows, and its values are stored in
// field_values with that row's id, so they get the same golden record,
// history and source tracking as every other value.

import { isEmptyValue, parseInput, type StoredValue } from './fieldFormat'
import { listFields, saveManualValue } from './fields'
import { recordExists, type Queryable, type RecordType } from './records'

export type ListDefinition = {
  id: string
  key: string
  name: string
  appliesTo: RecordType
  sectionId: string | null
  sortFieldKey: string | null
  sortDescending: boolean
}

/** Every list this organization sees. Pass null for the Stratios standard lists alone. */
export async function listLists(client: Queryable, orgId: string | null): Promise<ListDefinition[]> {
  const { rows } = await client.query(
    `select id::text as id, key, name, applies_to, section_id::text as section_id, sort_field_key, sort_descending
     from field_lists where org_id is null or org_id = $1 order by name`,
    [orgId],
  )
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    appliesTo: row.applies_to,
    sectionId: row.section_id ?? null,
    sortFieldKey: row.sort_field_key ?? null,
    sortDescending: Boolean(row.sort_descending),
  }))
}

export type ListRow = {
  id: string
  listId: string
  recordId: string
  /** Permanent number of the row within its list on this record. */
  rowNumber: number
  /** Values by field id. */
  values: Record<string, StoredValue>
}

/** The rows of every list on a set of records, excluding removed rows. */
export async function listRows(client: Queryable, orgId: string, recordIds: string[]): Promise<ListRow[]> {
  if (recordIds.length === 0) return []
  const rows = await client.query(
    `select id::text as id, list_id::text as list_id, record_id::text as record_id, row_number
     from field_list_rows
     where org_id = $1 and record_id = any($2::uuid[]) and removed_at is null
     order by row_number`,
    [orgId, recordIds],
  )
  if (rows.rows.length === 0) return []
  const values = await client.query(
    `select row_id::text as row_id, field_id::text as field_id,
            value_text as text, value_number::float8 as number, value_date::text as date, value_bool as bool
     from field_values
     where org_id = $1 and row_id = any($2::uuid[]) and status = 'approved'`,
    [orgId, rows.rows.map((row) => row.id)],
  )
  const byRow = new Map<string, Record<string, StoredValue>>()
  for (const value of values.rows) {
    const entry = byRow.get(value.row_id) ?? {}
    entry[value.field_id] = {
      text: value.text ?? null,
      number: value.number === null || value.number === undefined ? null : Number(value.number),
      date: value.date ?? null,
      bool: value.bool ?? null,
    }
    byRow.set(value.row_id, entry)
  }
  return rows.rows.map((row) => ({
    id: row.id,
    listId: row.list_id,
    recordId: row.record_id,
    rowNumber: Number(row.row_number),
    values: byRow.get(row.id) ?? {},
  }))
}

/** Orders rows by the list's sort column; rows without a value in it go last. */
export function sortRows(rows: ListRow[], sortFieldId: string | null, descending: boolean): ListRow[] {
  const keyOf = (row: ListRow): string | number | null => {
    const value = sortFieldId ? row.values[sortFieldId] : undefined
    if (!value) return null
    return value.date ?? value.number ?? value.text ?? null
  }
  return [...rows].sort((a, b) => {
    const left = keyOf(a)
    const right = keyOf(b)
    if (left === null && right === null) return a.rowNumber - b.rowNumber
    if (left === null) return 1
    if (right === null) return -1
    const order = left < right ? -1 : left > right ? 1 : a.rowNumber - b.rowNumber
    return descending && left !== right ? -order : order
  })
}

export type SaveRowInput = {
  listId: string
  recordType: RecordType
  recordId: string
  /** Leave out to add a new row. */
  rowId?: string | null
  /** What the person typed, by field id. Columns left out are not touched. */
  values: Record<string, string>
}

export type SaveRowResult = { ok: true; rowId: string } | { ok: false; error: string }

/**
 * Adds a row to a list, or changes an existing row. Every column goes through
 * the same save as any other field, so each change is recorded in history.
 */
export async function saveListRow(client: Queryable, orgId: string, userId: string, input: SaveRowInput): Promise<SaveRowResult> {
  if (!(await recordExists(client, orgId, input.recordType, input.recordId))) return { ok: false, error: 'That record could not be found.' }
  const list = (await listLists(client, orgId)).find((candidate) => candidate.id === input.listId)
  if (!list || list.appliesTo !== input.recordType) return { ok: false, error: 'That list could not be found.' }

  const columns = (await listFields(client, orgId)).filter((field) => field.listId === list.id)
  // Check every entry before anything is saved, so a row is never half-written.
  const entries: { fieldId: string; raw: string }[] = []
  let anyValue = false
  for (const column of columns) {
    if (!(column.id in input.values)) continue
    const raw = String(input.values[column.id] ?? '')
    const parsed = parseInput(column, raw)
    if (!parsed.ok) return { ok: false, error: `${column.name}: ${parsed.error}` }
    if (!isEmptyValue(parsed.value)) anyValue = true
    entries.push({ fieldId: column.id, raw })
  }

  let rowId = input.rowId ?? null
  if (rowId) {
    const existing = await client.query(
      'select 1 as found from field_list_rows where id = $1 and org_id = $2 and list_id = $3 and record_id = $4 and removed_at is null',
      [rowId, orgId, list.id, input.recordId],
    )
    if (existing.rows.length === 0) return { ok: false, error: 'That entry could not be found.' }
  } else {
    if (!anyValue) return { ok: false, error: 'Fill in at least one column.' }
    const next = await client.query(
      'select coalesce(max(row_number), 0) + 1 as next from field_list_rows where org_id = $1 and list_id = $2 and record_id = $3',
      [orgId, list.id, input.recordId],
    )
    const created = await client.query(
      `insert into field_list_rows (org_id, list_id, record_type, record_id, row_number, created_by)
       values ($1, $2, $3, $4, $5, $6) returning id::text as id`,
      [orgId, list.id, input.recordType, input.recordId, Number(next.rows[0].next), userId],
    )
    rowId = created.rows[0].id as string
  }

  for (const entry of entries) {
    const result = await saveManualValue(client, orgId, userId, {
      recordType: input.recordType,
      recordId: input.recordId,
      fieldId: entry.fieldId,
      raw: entry.raw,
      rowId,
    })
    if (!result.ok) throw new Error(result.error) // rolls the whole row back
  }
  return { ok: true, rowId }
}

/** Hides a row. Its values and history are kept. False when the row isn't this organization's. */
export async function removeListRow(client: Queryable, orgId: string, userId: string, rowId: string): Promise<boolean> {
  const { rows } = await client.query(
    `update field_list_rows set removed_at = now(), removed_by = $3
     where id = $1 and org_id = $2 and removed_at is null
     returning id::text as id`,
    [rowId, orgId, userId],
  )
  return rows.length > 0
}

