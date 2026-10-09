// Lists: fields grouped by row, such as Comments or Critical Dates.
//
// A list's columns are ordinary fields whose listId points at the list. Each
// entry is a row in field_list_rows, and its values are stored in
// field_values with that row's id, so they get the same golden record,
// history and source tracking as every other value.

import { isEmptyValue, parseInput, type StoredValue } from './fieldFormat'
import { listFields, saveManualValue, type FieldDefinition } from './fields'
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


// ---------------------------------------------------------------------------
// Entries the agent adds from a document
// ---------------------------------------------------------------------------

/** One entry the agent found in a document for a list, already checked against the list's columns. */
export type DocumentRow = {
  recordType: RecordType
  recordId: string
  list: ListDefinition
  /** Every column of the list, so columns the agent left out can start with their usual value. */
  columns: FieldDefinition[]
  page: number | null
  cells: { field: FieldDefinition; value: StoredValue }[]
}

const documentNote = (documentName: string, page: number | null) => `From "${documentName}"${page ? `, page ${page}` : ''}`

/**
 * Adds the entries the agent found in a document to their lists. Each value
 * is recorded as coming from Documents, with the document and page, and gets
 * its first history entry, exactly like a field filled in from a document.
 * A column the agent left out starts the way it does for a person: a date
 * that defaults to today gets today, and "who made it" gets the document's
 * name. Does nothing when this document's entries were already added.
 * Returns how many entries were added.
 */
export async function addDocumentRows(
  client: Queryable,
  orgId: string,
  userId: string,
  document: { id: string; name: string },
  rows: DocumentRow[],
): Promise<number> {
  if (rows.length === 0) return 0
  const already = await client.query(
    'select 1 as found from field_source_values where org_id = $1 and document_id = $2 and row_id is not null limit 1',
    [orgId, document.id],
  )
  if (already.rows.length > 0) return 0

  const today = new Date().toISOString().slice(0, 10)
  const author = document.name.replace(/\.(pdf|xlsx|xlsm)$/i, '').slice(0, 200)
  const known = new Map<string, boolean>()
  let added = 0
  for (const row of rows) {
    const recordKey = `${row.recordType}:${row.recordId}`
    if (!known.has(recordKey)) known.set(recordKey, await recordExists(client, orgId, row.recordType, row.recordId))
    if (!known.get(recordKey)) continue

    const cells = row.cells.filter((cell) => cell.field.listId === row.list.id && !isEmptyValue(cell.value))
    if (cells.length === 0) continue
    for (const column of row.columns) {
      if (column.listId !== row.list.id || cells.some((cell) => cell.field.id === column.id)) continue
      if (column.defaultValue === 'today' && column.dataType === 'date') cells.push({ field: column, value: { text: null, number: null, date: today, bool: null } })
      if (column.defaultValue === 'currentUser' && column.dataType === 'text' && author) cells.push({ field: column, value: { text: author, number: null, date: null, bool: null } })
    }

    const next = await client.query(
      'select coalesce(max(row_number), 0) + 1 as next from field_list_rows where org_id = $1 and list_id = $2 and record_id = $3',
      [orgId, row.list.id, row.recordId],
    )
    const created = await client.query(
      `insert into field_list_rows (org_id, list_id, record_type, record_id, row_number, created_by)
       values ($1, $2, $3, $4, $5, $6) returning id::text as id`,
      [orgId, row.list.id, row.recordType, row.recordId, Number(next.rows[0].next), userId],
    )
    const rowId = created.rows[0].id as string
    const note = documentNote(document.name, row.page).slice(0, 2000)
    for (const { field, value } of cells) {
      await client.query(
        `insert into field_values
           (org_id, record_type, record_id, field_id, period, value_text, value_number, value_date, value_bool,
            source_type, manual_override, status, note, updated_by, row_id)
         values ($1, $2, $3, $4, null, $5, $6::numeric, $7::date, $8::boolean, 'documents', false, 'approved', $9, $10, $11::uuid)`,
        [orgId, row.recordType, row.recordId, field.id, value.text, value.number, value.date, value.bool, note, userId, rowId],
      )
      await client.query(
        `insert into field_value_history
           (org_id, record_type, record_id, field_id, period, new_text, new_number, new_date, new_bool, source_type, note, changed_by, row_id)
         values ($1, $2, $3, $4, null, $5, $6::numeric, $7::date, $8::boolean, 'documents', $9, $10, $11::uuid)`,
        [orgId, row.recordType, row.recordId, field.id, value.text, value.number, value.date, value.bool, note, userId, rowId],
      )
      await client.query(
        `insert into field_source_values
           (org_id, record_type, record_id, field_id, period, source_type, value_text, value_number, value_date, value_bool, received_by, row_id, document_id, page)
         values ($1, $2, $3, $4, null, 'documents', $5, $6::numeric, $7::date, $8::boolean, $9, $10::uuid, $11::uuid, $12)`,
        [orgId, row.recordType, row.recordId, field.id, value.text, value.number, value.date, value.bool, userId, rowId, document.id, row.page],
      )
    }
    added += 1
  }
  return added
}

/** A list entry that came from a document, as it stands now. */
export type DocumentListRow = ListRow & { recordType: RecordType; page: number | null }

/** The entries a document added to lists that have not been removed since, in list and entry order. */
export async function listDocumentRows(client: Queryable, orgId: string, documentId: string): Promise<DocumentListRow[]> {
  const found = await client.query(
    `select r.id::text as id, r.list_id::text as list_id, r.record_type, r.record_id::text as record_id, r.row_number, max(s.page) as page
     from field_list_rows r
     join field_source_values s on s.row_id = r.id and s.org_id = r.org_id
     where r.org_id = $1 and s.document_id = $2 and r.removed_at is null
     group by r.id, r.list_id, r.record_type, r.record_id, r.row_number
     order by r.list_id, r.record_id, r.row_number`,
    [orgId, documentId],
  )
  if (found.rows.length === 0) return []
  const values = await client.query(
    `select row_id::text as row_id, field_id::text as field_id,
            value_text as text, value_number::float8 as number, value_date::text as date, value_bool as bool
     from field_values
     where org_id = $1 and row_id = any($2::uuid[]) and status = 'approved'`,
    [orgId, found.rows.map((row) => row.id)],
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
  return found.rows.map((row) => ({
    id: row.id,
    listId: row.list_id,
    recordType: row.record_type,
    recordId: row.record_id,
    rowNumber: Number(row.row_number),
    page: row.page === null || row.page === undefined ? null : Number(row.page),
    values: byRow.get(row.id) ?? {},
  }))
}
