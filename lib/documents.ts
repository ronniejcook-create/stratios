// Documents: uploaded files linked to an asset, what the extraction agent
// found in them, and the review list.
//
// The file is stored in the database in pieces (document_chunks), because the
// web host limits how much one request can carry and this needs no storage
// service to be set up. Everything goes through this file, so the pieces can
// later move to a storage service without touching the rest of the app.
//
// Every function takes the database client of a transaction scoped to one
// organization (see withOrg in lib/db.ts).

import { EMPTY_VALUE, isEmptyValue, sameValue, type StoredValue } from './fieldFormat'
import { clearMisfitDependents, dependentProblem, listFields, type FieldDefinition } from './fields'
import { recordExists, tableFor, type Queryable, type RecordType } from './records'

/** The largest file that can be uploaded. Claude accepts about 32 MB per request, and a PDF grows by a third when sent. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
/** The size of one upload piece: under the web host's limit of about 4.5 MB per request. */
export const CHUNK_BYTES = 3 * 1024 * 1024
export const DOCUMENT_TYPE = 'application/pdf'
/** Kept in step with XLSX_TYPE in lib/spreadsheet.ts, which is not imported here so this file stays usable in the browser. */
export const WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
/** The kinds of file that can be uploaded: a PDF, or an Excel workbook (.xlsx). */
export type DocumentKind = 'pdf' | 'xlsx'

/** What kind of file this is, going by its name first and its type second. Null when it can't be uploaded. */
export function documentKind(name: string, contentType: string): DocumentKind | null {
  if (/\.pdf$/i.test(name)) return 'pdf'
  if (/\.xls[xm]$/i.test(name)) return 'xlsx'
  if (contentType === DOCUMENT_TYPE) return 'pdf'
  if (contentType === WORKBOOK_TYPE) return 'xlsx'
  return null
}
export const UNSUPPORTED_FILE = 'Only PDF files and Excel workbooks (.xlsx) can be uploaded. Save an older .xls file as .xlsx first.'

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export type DocumentStatus = 'uploading' | 'uploaded' | 'reading' | 'read' | 'failed'

export type DocumentRecord = {
  id: string
  /** Null while the document has been handed to the agent but not yet tied to an asset. */
  assetId: string | null
  /** The lease this document was loaded onto (a lease agreement or amendment); null for any other document. */
  leaseId: string | null
  name: string
  kind: DocumentKind
  sizeBytes: number
  chunkCount: number
  status: DocumentStatus
  error: string | null
  documentType: string | null
  summary: string | null
  uploadedBy: string
  uploadedAt: string
  readAt: string | null
  /** True when a reading was started long enough ago that it must have stopped without finishing. */
  stalled: boolean
}

// lease_id arrives with migration 028; read this way documents still load before it is run.
const DOCUMENT_COLUMNS = `id::text as id, asset_id::text as asset_id, to_jsonb(documents) ->> 'lease_id' as lease_id, name, content_type, size_bytes::float8 as size_bytes, chunk_count, status, error,
  document_type, summary, uploaded_by,
  to_char(uploaded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as uploaded_at,
  to_char(read_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as read_at,
  (status = 'reading' and read_started_at < now() - interval '6 minutes') as stalled`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDocument(row: any): DocumentRecord {
  return {
    id: row.id,
    assetId: row.asset_id ?? null,
    leaseId: row.lease_id ?? null,
    name: row.name,
    kind: row.content_type === WORKBOOK_TYPE ? 'xlsx' : 'pdf',
    sizeBytes: Number(row.size_bytes),
    chunkCount: Number(row.chunk_count),
    status: row.status,
    error: row.error ?? null,
    documentType: row.document_type ?? null,
    summary: row.summary ?? null,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    readAt: row.read_at ?? null,
    stalled: Boolean(row.stalled),
  }
}

// ---------------------------------------------------------------------------
// Uploading and storing
// ---------------------------------------------------------------------------

/** Starts an upload: records the document and says how many pieces to send. */
export async function createDocument(
  client: Queryable,
  orgId: string,
  userId: string,
  input: { assetId: string | null; name: string; sizeBytes: number; contentType: string },
): Promise<Result<{ id: string; chunkCount: number }>> {
  const name = input.name.replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!name) return { ok: false, error: 'The file needs a name.' }
  const kind = documentKind(name, input.contentType)
  if (!kind) return { ok: false, error: UNSUPPORTED_FILE }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false, error: 'That file is empty.' }
  if (input.sizeBytes > MAX_DOCUMENT_BYTES) return { ok: false, error: `That file is too large. The limit is ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.` }
  if (input.assetId !== null && !(await recordExists(client, orgId, 'asset', input.assetId))) return { ok: false, error: 'That asset could not be found.' }
  const chunkCount = Math.ceil(input.sizeBytes / CHUNK_BYTES)
  const { rows } = await client.query(
    `insert into documents (org_id, asset_id, name, content_type, size_bytes, chunk_count, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id::text as id`,
    [orgId, input.assetId, name, kind === 'xlsx' ? WORKBOOK_TYPE : DOCUMENT_TYPE, input.sizeBytes, chunkCount, userId],
  )
  return { ok: true, id: rows[0].id, chunkCount }
}

/** Stores one piece of a file that is still uploading. Only the person who started the upload may add to it. */
export async function saveChunk(client: Queryable, orgId: string, userId: string, documentId: string, index: number, data: Buffer): Promise<Result> {
  const { rows } = await client.query(
    `select chunk_count, size_bytes::float8 as size_bytes from documents
     where id = $1 and org_id = $2 and uploaded_by = $3 and status = 'uploading'`,
    [documentId, orgId, userId],
  )
  if (rows.length === 0) return { ok: false, error: 'That upload could not be found.' }
  const chunkCount = Number(rows[0].chunk_count)
  if (!Number.isInteger(index) || index < 0 || index >= chunkCount) return { ok: false, error: 'That piece does not belong to this upload.' }
  // Every piece is full size except the last, which holds the remainder.
  const expected = index === chunkCount - 1 ? Number(rows[0].size_bytes) - CHUNK_BYTES * (chunkCount - 1) : CHUNK_BYTES
  if (data.length !== expected) return { ok: false, error: 'That piece is the wrong size.' }
  await client.query(
    `insert into document_chunks (document_id, org_id, chunk_index, data) values ($1, $2, $3, $4)
     on conflict (document_id, chunk_index) do update set data = excluded.data`,
    [documentId, orgId, index, data],
  )
  return { ok: true }
}

/** Finishes an upload once every piece has arrived and the file really is what its name says: a PDF, or a workbook. */
export async function completeUpload(client: Queryable, orgId: string, userId: string, documentId: string): Promise<Result> {
  const { rows } = await client.query(
    `select d.chunk_count, d.size_bytes::float8 as size_bytes, d.content_type,
            (select count(*)::int from document_chunks c where c.document_id = d.id) as chunks,
            (select coalesce(sum(length(c.data)), 0)::float8 from document_chunks c where c.document_id = d.id) as bytes,
            (select encode(substring(c.data from 1 for 5), 'escape') from document_chunks c where c.document_id = d.id and c.chunk_index = 0) as head
     from documents d
     where d.id = $1 and d.org_id = $2 and d.uploaded_by = $3 and d.status = 'uploading'`,
    [documentId, orgId, userId],
  )
  if (rows.length === 0) return { ok: false, error: 'That upload could not be found.' }
  const row = rows[0]
  if (Number(row.chunks) !== Number(row.chunk_count) || Number(row.bytes) !== Number(row.size_bytes)) {
    return { ok: false, error: 'The upload did not finish. Try uploading the file again.' }
  }
  // A PDF starts with "%PDF"; an .xlsx workbook is a zip file, which starts with "PK".
  const workbook = row.content_type === WORKBOOK_TYPE
  if (!String(row.head ?? '').startsWith(workbook ? 'PK' : '%PDF')) {
    await client.query('delete from documents where id = $1 and org_id = $2', [documentId, orgId])
    return { ok: false, error: workbook ? 'That file is not an Excel workbook (.xlsx). An older .xls file needs to be saved as .xlsx first.' : 'That file is not a PDF.' }
  }
  await client.query(`update documents set status = 'uploaded' where id = $1 and org_id = $2`, [documentId, orgId])
  return { ok: true }
}

export async function getDocument(client: Queryable, orgId: string, documentId: string): Promise<DocumentRecord | null> {
  const { rows } = await client.query(`select ${DOCUMENT_COLUMNS} from documents where id = $1 and org_id = $2`, [documentId, orgId])
  return rows.length > 0 ? toDocument(rows[0]) : null
}

export type DocumentSummary = DocumentRecord & { counts: Record<Outcome, number>; undecided: number; proposals: number }

/** An asset's documents, newest first, with a count of what the agent found in each. Unfinished uploads are left out. */
export async function listDocuments(client: Queryable, orgId: string, assetId: string): Promise<DocumentSummary[]> {
  const { rows } = await client.query(
    `select ${DOCUMENT_COLUMNS} from documents where org_id = $1 and asset_id = $2 and status <> 'uploading' order by uploaded_at desc`,
    [orgId, assetId],
  )
  const documents = rows.map(toDocument)
  if (documents.length === 0) return []
  const ids = documents.map((document) => document.id)
  const findings = await client.query(
    `select document_id::text as document_id, outcome, count(*)::int as total,
            count(*) filter (where outcome = 'decision' and decision is null)::int as undecided
     from document_findings where org_id = $1 and document_id = any($2::uuid[]) group by document_id, outcome`,
    [orgId, ids],
  )
  const proposals = await client.query(
    `select document_id::text as document_id, count(*)::int as total
     from field_proposals where org_id = $1 and document_id = any($2::uuid[]) and status = 'proposed' group by document_id`,
    [orgId, ids],
  )
  return documents.map((document) => {
    const counts: Record<Outcome, number> = { filled: 0, confirmed: 0, replaced: 0, decision: 0, kept: 0 }
    let undecided = 0
    for (const row of findings.rows) {
      if (row.document_id !== document.id) continue
      counts[row.outcome as Outcome] = Number(row.total)
      undecided += Number(row.undecided)
    }
    return { ...document, counts, undecided, proposals: Number(proposals.rows.find((row) => row.document_id === document.id)?.total ?? 0) }
  })
}

/** Ties a document that has no asset yet to one. Returns false if it already belongs to an asset. */
export async function attachDocument(client: Queryable, orgId: string, documentId: string, assetId: string): Promise<boolean> {
  const { rows } = await client.query(
    'update documents set asset_id = $3 where id = $1 and org_id = $2 and asset_id is null returning id::text as id',
    [documentId, orgId, assetId],
  )
  return rows.length > 0
}

/** Ties a document to the lease it was loaded onto. */
export async function setDocumentLease(client: Queryable, orgId: string, documentId: string, leaseId: string): Promise<void> {
  await client.query('update documents set lease_id = $3::uuid where id = $1 and org_id = $2', [documentId, orgId, leaseId])
}

/**
 * Lets a document that was read as an ordinary document be read again, onto a
 * lease: a lease agreement first loaded on the asset or handed to the analyst.
 * Only a document that is read and tied to no lease yet.
 */
export async function reopenForLease(client: Queryable, orgId: string, documentId: string): Promise<void> {
  await client.query(`update documents set status = 'uploaded' where id = $1 and org_id = $2 and status = 'read' and (to_jsonb(documents) ->> 'lease_id') is null`, [documentId, orgId])
}

/** The whole file, put back together from its pieces. */
export async function readDocumentFile(client: Queryable, orgId: string, documentId: string): Promise<Buffer | null> {
  const { rows } = await client.query(
    'select data from document_chunks where document_id = $1 and org_id = $2 order by chunk_index',
    [documentId, orgId],
  )
  if (rows.length === 0) return null
  return Buffer.concat(rows.map((row) => row.data as Buffer))
}

/**
 * Removes a document, its file and its review list. Values it already filled
 * in stay in the golden record and its history.
 */
export async function removeDocument(client: Queryable, orgId: string, documentId: string): Promise<boolean> {
  const { rows } = await client.query('delete from documents where id = $1 and org_id = $2 returning id::text as id', [documentId, orgId])
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Reading: status, and applying what the agent found
// ---------------------------------------------------------------------------

/**
 * Marks a document as being read. Returns false when it is already being
 * read, or has been read, so two readings can't run at once.
 */
export async function startReading(client: Queryable, orgId: string, userId: string, documentId: string): Promise<boolean> {
  const { rows } = await client.query(
    `update documents
     set status = 'reading', error = null, read_started_at = now(), read_by = $3
     where id = $1 and org_id = $2
       and (status in ('uploaded', 'failed') or (status = 'reading' and read_started_at < now() - interval '6 minutes'))
     returning id::text as id`,
    [documentId, orgId, userId],
  )
  return rows.length > 0
}

export async function failReading(client: Queryable, orgId: string, documentId: string, error: string): Promise<void> {
  await client.query(`update documents set status = 'failed', error = $3 where id = $1 and org_id = $2 and status = 'reading'`, [
    documentId, orgId, error.slice(0, 500),
  ])
}

export type Outcome = 'filled' | 'confirmed' | 'replaced' | 'decision' | 'kept'
export type Confidence = 'high' | 'medium' | 'low'
const CONFIDENCE_SCORE: Record<Confidence, number> = { high: 0.9, medium: 0.6, low: 0.3 }

/** One value the agent found, already checked against the dictionary and parsed for its field's type. */
export type Candidate = {
  recordType: RecordType
  recordId: string
  field: FieldDefinition
  /** First day of the month for a monthly field, otherwise null. */
  period: string | null
  value: StoredValue
  page: number | null
  confidence: Confidence
  /** Whether the document shows the value, or the agent worked it out from the document's figures. Stated when left out. */
  basis?: 'stated' | 'calculated'
  quote: string | null
  /**
   * The agent's call, under the skills that say which source wins, on what to
   * do when the record already holds a different value: replace it, ask a
   * person, or keep what is there. Left out when no skill covers it; the
   * field's own settings then decide.
   */
  call?: SourceCall | null
}

/** What the skills say to do with a value that differs from the one on record. */
export type SourceCall = 'replace' | 'ask' | 'keep'

/** Reads the agent's answer for a value's call; anything else (including "field") means the field's own settings decide. */
export function readSourceCall(raw: unknown): SourceCall | null {
  const said = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return said === 'replace' || said === 'ask' || said === 'keep' ? said : null
}

/** A value a record holds now, with where it came from, as the agents are told about it. */
export type CurrentValue = {
  recordId: string
  fieldId: string
  /** First day of the month for a monthly field, else null. */
  period: string | null
  value: StoredValue
  /** Where the value came from, in words an agent can weigh against the skills: the source, the document and its kind, the dates. */
  source: string
}

/**
 * The values a set of records hold now and where each came from, so an agent
 * can apply the skills that say which source wins (a rent roll over an
 * offering memorandum, a newer document over an older one). Never throws:
 * without it the agents simply make no call and each field's settings decide.
 */
export async function listCurrentValues(client: Queryable, orgId: string, recordIds: string[]): Promise<CurrentValue[]> {
  if (recordIds.length === 0) return []
  try {
    await client.query('savepoint current_values')
  } catch {
    return []
  }
  try {
    const { rows } = await client.query(
      `select v.record_id::text as record_id, v.field_id::text as field_id, v.period::text as period, ${VALUE_COLUMNS.replace(/value_/g, 'v.value_')},
              v.source_type, v.manual_override, to_char(v.updated_at at time zone 'UTC', 'YYYY-MM-DD') as updated,
              d.name as document_name, d.document_type, to_char(d.read_at at time zone 'UTC', 'YYYY-MM-DD') as document_read,
              (select r.as_of_date::text from rent_rolls r where r.document_id = d.id limit 1) as rent_roll_date
       from field_values v
       left join lateral (
         -- The document that gave this very value. What Documents says is kept per field, and a later document whose
         -- value was not taken overwrites it, so the value has to match; failing that, the name in the value's note.
         select coalesce(
           (select s.document_id from field_source_values s
            where s.org_id = v.org_id and s.record_id = v.record_id and s.field_id = v.field_id and s.source_type = v.source_type
              and s.period is not distinct from v.period and s.row_id is null and s.document_id is not null
              and s.value_text is not distinct from v.value_text and s.value_number is not distinct from v.value_number
              and s.value_date is not distinct from v.value_date and s.value_bool is not distinct from v.value_bool
            limit 1),
           (select n.id from documents n
            where n.org_id = v.org_id and n.name = substring(v.note from '^(?:Calculated from|From) "(.*?)"')
            order by n.read_at desc nulls last limit 1)
         ) as document_id
       ) s on true
       left join documents d on d.id = s.document_id
       where v.org_id = $1 and v.record_id = any($2::uuid[]) and v.row_id is null and v.status = 'approved'
       order by v.period desc nulls first`,
      [orgId, recordIds],
    )
    await client.query('release savepoint current_values')
    return rows.flatMap((row) => {
      const value: StoredValue = { text: row.text ?? null, number: row.number === null || row.number === undefined ? null : Number(row.number), date: row.date ?? null, bool: row.bool ?? null }
      if (isEmptyValue(value)) return []
      const from = row.document_name
        ? ` the document "${row.document_name}"${row.document_type ? ` (${row.document_type}${row.rent_roll_date ? `, rent roll as of ${row.rent_roll_date}` : ''})` : row.rent_roll_date ? ` (rent roll as of ${row.rent_roll_date})` : ''}${row.document_read ? `, read ${row.document_read}` : ''}`
        : ''
      const source =
        row.source_type === 'manual' ? `typed in by a person on ${row.updated}` :
        row.source_type === 'documents' ? `taken as shown from${from || ' a document'}` :
        row.source_type === 'calculated' ? (from ? `calculated by the agent from${from}` : `calculated by the agent from the stored leases on ${row.updated}`) :
        row.source_type === 'marketData' ? `looked up from a public source on ${row.updated}` :
        `from ${row.source_type} on ${row.updated}`
      return [{ recordId: row.record_id, fieldId: row.field_id, period: row.period ?? null, value, source }]
    })
  } catch (error) {
    console.error('Reading the current values for the agent failed; continuing without them', error)
    await client.query('rollback to savepoint current_values').catch(() => {})
    return []
  }
}

export type ProposalInput = {
  recordType: 'asset' | 'property' | 'building'
  recordId: string
  name: string
  dataType: 'text' | 'number' | 'money' | 'percent' | 'date' | 'boolean'
  value: string
  page: number | null
  reason: string | null
}

type Golden = { rowId: string | null; value: StoredValue; sourceType: string | null; manualOverride: boolean }

const VALUE_COLUMNS = `value_text as text, value_number::float8 as number, value_date::text as date, value_bool as bool`

/** The golden record for one field on one record (locked, so two writers can't cross). */
async function readGolden(client: Queryable, orgId: string, recordType: RecordType, recordId: string, field: FieldDefinition, period: string | null): Promise<Golden> {
  const { rows } = await client.query(
    `select id::text as id, ${VALUE_COLUMNS}, source_type, manual_override
     from field_values
     where org_id = $1 and record_type = $2 and record_id = $3 and field_id = $4
       and period is not distinct from $5::date and row_id is null
     for update`,
    [orgId, recordType, recordId, field.id, period],
  )
  if (rows.length > 0) {
    const row = rows[0]
    return {
      rowId: row.id,
      value: {
        text: row.text ?? null,
        number: row.number === null || row.number === undefined ? null : Number(row.number),
        date: row.date ?? null,
        bool: row.bool ?? null,
      },
      sourceType: row.source_type,
      manualOverride: Boolean(row.manual_override),
    }
  }
  if (field.coreColumn) {
    // Name and property type also live in a fixed column; start from that.
    const core = await client.query(`select ${field.coreColumn} as value from ${tableFor(recordType)} where id = $1 and org_id = $2`, [recordId, orgId])
    const text = core.rows[0]?.value ?? null
    return { rowId: null, value: { ...EMPTY_VALUE, text }, sourceType: text ? 'manual' : null, manualOverride: Boolean(text) }
  }
  return { rowId: null, value: { ...EMPTY_VALUE }, sourceType: null, manualOverride: false }
}

/** Makes a document's value the golden record and adds the history row. */
async function writeGolden(
  client: Queryable,
  orgId: string,
  userId: string,
  target: { recordType: RecordType; recordId: string; field: FieldDefinition; period: string | null },
  golden: Golden,
  next: StoredValue,
  confidence: Confidence | null,
  note: string,
  source: 'documents' | 'calculated' = 'documents',
): Promise<void> {
  const { recordType, recordId, field, period } = target
  const score = confidence ? CONFIDENCE_SCORE[confidence] : null
  if (golden.rowId) {
    await client.query(
      `update field_values
       set value_text = $2, value_number = $3::numeric, value_date = $4::date, value_bool = $5::boolean,
           source_type = $10, manual_override = false, status = 'approved', confidence = $6::numeric,
           note = $7, updated_by = $8, updated_at = now()
       where id = $1 and org_id = $9`,
      [golden.rowId, next.text, next.number, next.date, next.bool, score, note, userId, orgId, source],
    )
  } else {
    await client.query(
      `insert into field_values
         (org_id, record_type, record_id, field_id, period, value_text, value_number, value_date, value_bool,
          source_type, manual_override, status, confidence, note, updated_by)
       values ($1, $2, $3, $4, $5::date, $6, $7::numeric, $8::date, $9::boolean, $13, false, 'approved', $10::numeric, $11, $12)`,
      [orgId, recordType, recordId, field.id, period, next.text, next.number, next.date, next.bool, score, note, userId, source],
    )
  }
  await client.query(
    `insert into field_value_history
       (org_id, record_type, record_id, field_id, period,
        old_text, old_number, old_date, old_bool, new_text, new_number, new_date, new_bool, source_type, note, changed_by)
     values ($1, $2, $3, $4, $5::date, $6, $7::numeric, $8::date, $9::boolean, $10, $11::numeric, $12::date, $13::boolean, $16, $14, $15)`,
    [
      orgId, recordType, recordId, field.id, period,
      golden.value.text, golden.value.number, golden.value.date, golden.value.bool,
      next.text, next.number, next.date, next.bool, note, userId, source,
    ],
  )
  if (field.coreColumn) {
    await client.query(`update ${tableFor(recordType)} set ${field.coreColumn} = $1 where id = $2 and org_id = $3`, [next.text, recordId, orgId])
  }
}

const sourceNote = (documentName: string, page: number | null) => `From "${documentName}"${page ? `, page ${page}` : ''}`
/** The history note for a value the agent worked out: where the inputs are, and the working. */
const calculatedNote = (documentName: string, page: number | null, working: string | null) =>
  `Calculated from "${documentName}"${page ? `, page ${page}` : ''}${working ? `: ${working}` : ''}`.slice(0, 2000)

/** Whether the review list can remember stated or calculated (migration 018). */
async function hasBasisColumn(client: Queryable): Promise<boolean> {
  const { rows } = await client.query(
    `select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'document_findings' and column_name = 'basis'`,
  )
  return rows.length > 0
}

/**
 * What should happen to a value found in a document, given the golden record
 * and the field's rules. Pure, so it can be reasoned about and tested alone.
 *
 *   empty field          When the Field Is Empty: fill automatically, or ask
 *   same value           confirmed; nothing changes
 *   different value      Never Replace: kept
 *                        a hand-entered value that Stays Until Someone Changes It: ask
 *                        Replace Automatically: replaced
 *                        otherwise: ask
 */
export function decideOutcome(
  field: Pick<FieldDefinition, 'whenEmpty' | 'whenDifferent' | 'manualOverride'>,
  golden: { value: StoredValue; manualOverride: boolean },
  found: StoredValue,
): { outcome: Outcome; reason: 'empty' | 'different' | 'manual' | null } {
  if (isEmptyValue(golden.value)) {
    return field.whenEmpty === 'fill' ? { outcome: 'filled', reason: null } : { outcome: 'decision', reason: 'empty' }
  }
  if (sameValue(golden.value, found)) return { outcome: 'confirmed', reason: null }
  if (field.whenDifferent === 'never') return { outcome: 'kept', reason: null }
  if (golden.manualOverride && field.manualOverride === 'stays') return { outcome: 'decision', reason: 'manual' }
  if (field.whenDifferent === 'replace') return { outcome: 'replaced', reason: null }
  return { outcome: 'decision', reason: 'different' }
}

/**
 * Other rent rolls for the same property and date as the document being read,
 * by document: those with at least as many rows (they outrank this one) and
 * those with fewer (this one outranks them).
 */
export type DocumentRivals = { larger: string[]; smaller: string[] }

/** What a document last said about one field on one record: its value, and which document. Null when none did. */
async function rivalValue(
  client: Queryable,
  orgId: string,
  target: { recordType: RecordType; recordId: string; field: FieldDefinition; period: string | null },
): Promise<{ documentId: string; value: StoredValue } | null> {
  const { rows } = await client.query(
    `select document_id::text as document_id, ${VALUE_COLUMNS}
     from field_source_values
     where org_id = $1 and record_type = $2 and record_id = $3 and field_id = $4
       and period is not distinct from $5::date and row_id is null
       and source_type in ('documents', 'calculated') and document_id is not null
     order by received_at desc limit 1`,
    [orgId, target.recordType, target.recordId, target.field.id, target.period],
  )
  const row = rows[0]
  if (!row) return null
  return {
    documentId: row.document_id,
    value: { text: row.text ?? null, number: row.number === null || row.number === undefined ? null : Number(row.number), date: row.date ?? null, bool: row.bool ?? null },
  }
}

/**
 * Records everything the agent found in a document and applies each field's
 * rules. Every value is stored as what Documents says (a source value),
 * whether or not it changes the golden record. Marks the document as read.
 */
export async function applyReading(
  client: Queryable,
  orgId: string,
  userId: string,
  document: { id: string; name: string },
  reading: { candidates: Candidate[]; proposals: ProposalInput[]; documentType: string | null; summary: string | null },
  rivals: DocumentRivals | null = null,
): Promise<Record<Outcome, number>> {
  const counts: Record<Outcome, number> = { filled: 0, confirmed: 0, replaced: 0, decision: 0, kept: 0 }
  // A second reading replaces the first one's list; decisions already applied stay in the golden record.
  await client.query('delete from document_findings where org_id = $1 and document_id = $2', [orgId, document.id])
  await client.query(`delete from field_proposals where org_id = $1 and document_id = $2 and status = 'proposed'`, [orgId, document.id])
  const keepBasis = await hasBasisColumn(client)

  // Fields that others depend on go first, so a subtype is weighed against the type this same document gave.
  const allFields = await listFields(client, orgId)
  const isParent = (field: FieldDefinition) => allFields.some((other) => other.dependsOn === field.key && other.appliesTo === field.appliesTo)
  const ordered = [...reading.candidates].sort((a, b) => Number(isParent(b.field)) - Number(isParent(a.field)))

  for (const candidate of ordered) {
    const { recordType, recordId, field, period, value: found } = candidate
    if (isEmptyValue(found) || !(await recordExists(client, orgId, recordType, recordId))) continue
    // A choice that does not belong to what the parent field holds (a subtype of another property type) is left out.
    if (field.dependsOn && field.dataType === 'picklist' && found.text && (await dependentProblem(client, orgId, allFields, field, recordType, recordId, found.text))) continue
    const golden = await readGolden(client, orgId, recordType, recordId, field, period)
    let { outcome, reason } = decideOutcome(field, golden, found)
    // Two rent rolls for the same property and date (a mixed-use building): where both give a value for the
    // same field, the one with more rows wins, whichever was loaded first.
    let outranked = false
    if (rivals && (outcome === 'decision' || outcome === 'kept' || outcome === 'replaced') && !isEmptyValue(golden.value)) {
      const said = await rivalValue(client, orgId, { recordType, recordId, field, period })
      if (said && sameValue(said.value, golden.value)) {
        if (rivals.larger.includes(said.documentId)) {
          outcome = 'kept'
          reason = null
          outranked = true
        } else if (rivals.smaller.includes(said.documentId)) {
          outcome = 'replaced'
          reason = null
        }
      }
    }
    // Which source wins is the skills' call: where the agent made one for a value that differs from the one
    // on record, it stands in place of the field's own settings. The same-date rent roll rule above still holds.
    if (!outranked && candidate.call && (outcome === 'decision' || outcome === 'kept' || outcome === 'replaced') && !isEmptyValue(golden.value) && !sameValue(golden.value, found)) {
      outcome = candidate.call === 'replace' ? 'replaced' : candidate.call === 'keep' ? 'kept' : 'decision'
      reason = outcome === 'decision' ? (golden.manualOverride ? 'manual' : 'different') : null
    }
    // A value the agent worked out is recorded as Calculated, not as what the document says.
    const source = candidate.basis === 'calculated' ? 'calculated' : 'documents'

    // The larger rent roll's value stays on record as what the source says; the smaller one's is only listed for review.
    if (!outranked) {
      await client.query(
        `delete from field_source_values
         where org_id = $1 and record_type = $2 and record_id = $3 and field_id = $4 and source_type = $6
           and period is not distinct from $5::date and row_id is null`,
        [orgId, recordType, recordId, field.id, period, source],
      )
      await client.query(
        `insert into field_source_values
           (org_id, record_type, record_id, field_id, period, source_type, value_text, value_number, value_date, value_bool, received_by, document_id, page)
         values ($1, $2, $3, $4, $5::date, $13, $6, $7::numeric, $8::date, $9::boolean, $10, $11, $12)`,
        [orgId, recordType, recordId, field.id, period, found.text, found.number, found.date, found.bool, userId, document.id, candidate.page, source],
      )
    }

    if (outcome === 'filled' || outcome === 'replaced') {
      const note = source === 'calculated' ? calculatedNote(document.name, candidate.page, candidate.quote) : sourceNote(document.name, candidate.page)
      await writeGolden(client, orgId, userId, { recordType, recordId, field, period }, golden, found, candidate.confidence, note, source)
      if (field.dataType === 'picklist') await clearMisfitDependents(client, orgId, userId, allFields, field, recordType, recordId)
    }
    const finding = await client.query(
      `insert into document_findings
         (org_id, document_id, record_type, record_id, field_id, period, value_text, value_number, value_date, value_bool,
          page, confidence, quote, outcome, reason, current_text, current_number, current_date_value, current_bool, current_source)
       values ($1, $2, $3, $4, $5, $6::date, $7, $8::numeric, $9::date, $10::boolean, $11, $12, $13, $14, $15, $16, $17::numeric, $18::date, $19::boolean, $20)
       returning id::text as id`,
      [
        orgId, document.id, recordType, recordId, field.id, period, found.text, found.number, found.date, found.bool,
        candidate.page, candidate.confidence, candidate.quote?.slice(0, 500) ?? null, outcome, reason,
        golden.value.text, golden.value.number, golden.value.date, golden.value.bool, golden.sourceType,
      ],
    )
    if (keepBasis) await client.query('update document_findings set basis = $2 where id = $1 and org_id = $3', [finding.rows[0].id, candidate.basis ?? 'stated', orgId])
    counts[outcome] += 1
  }

  for (const proposal of reading.proposals) {
    if (!(await recordExists(client, orgId, proposal.recordType, proposal.recordId))) continue
    await client.query(
      `insert into field_proposals (org_id, document_id, record_type, record_id, name, data_type, value, page, reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [orgId, document.id, proposal.recordType, proposal.recordId, proposal.name.slice(0, 100), proposal.dataType, proposal.value.slice(0, 500), proposal.page, proposal.reason?.slice(0, 500) ?? null],
    )
  }

  await client.query(
    `update documents set status = 'read', error = null, read_at = now(), document_type = $3, summary = $4 where id = $1 and org_id = $2`,
    [document.id, orgId, reading.documentType?.slice(0, 100) ?? null, reading.summary?.slice(0, 2000) ?? null],
  )
  return counts
}

// ---------------------------------------------------------------------------
// The review list
// ---------------------------------------------------------------------------

export type Finding = {
  id: string
  recordType: RecordType
  recordId: string
  fieldId: string
  period: string | null
  value: StoredValue
  page: number | null
  confidence: Confidence | null
  quote: string | null
  /** Whether the document showed the value or the agent calculated it. */
  basis: 'stated' | 'calculated'
  outcome: Outcome
  reason: 'empty' | 'different' | 'manual' | null
  current: StoredValue
  currentSource: string | null
  decision: 'accepted' | 'rejected' | null
}

export async function listFindings(client: Queryable, orgId: string, documentId: string): Promise<Finding[]> {
  const { rows } = await client.query(
    `select id::text as id, record_type, record_id::text as record_id, field_id::text as field_id, period::text as period,
            ${VALUE_COLUMNS}, page, confidence, quote, outcome, reason, to_jsonb(document_findings) ->> 'basis' as basis,
            current_text, current_number::float8 as current_number, current_date_value::text as current_date, current_bool, current_source, decision
     from document_findings where org_id = $1 and document_id = $2 order by created_at, id`,
    [orgId, documentId],
  )
  const number = (value: unknown) => (value === null || value === undefined ? null : Number(value))
  return rows.map((row) => ({
    id: row.id,
    recordType: row.record_type,
    recordId: row.record_id,
    fieldId: row.field_id,
    period: row.period ?? null,
    value: { text: row.text ?? null, number: number(row.number), date: row.date ?? null, bool: row.bool ?? null },
    page: row.page ?? null,
    confidence: row.confidence ?? null,
    quote: row.quote ?? null,
    basis: row.basis === 'calculated' ? 'calculated' : 'stated',
    outcome: row.outcome,
    reason: row.reason ?? null,
    current: { text: row.current_text ?? null, number: number(row.current_number), date: row.current_date ?? null, bool: row.current_bool ?? null },
    currentSource: row.current_source ?? null,
    decision: row.decision ?? null,
  }))
}

export type Proposal = ProposalInput & { id: string; status: 'proposed' | 'added' | 'dismissed'; fieldId: string | null }

export async function listProposals(client: Queryable, orgId: string, documentId: string): Promise<Proposal[]> {
  const { rows } = await client.query(
    `select id::text as id, record_type, record_id::text as record_id, name, data_type, value, page, reason, status, field_id::text as field_id
     from field_proposals where org_id = $1 and document_id = $2 order by created_at, id`,
    [orgId, documentId],
  )
  return rows.map((row) => ({
    id: row.id,
    recordType: row.record_type,
    recordId: row.record_id,
    name: row.name,
    dataType: row.data_type,
    value: row.value,
    page: row.page ?? null,
    reason: row.reason ?? null,
    status: row.status,
    fieldId: row.field_id ?? null,
  }))
}

/** One finding that is waiting for a decision, with its document's name. Null when it isn't waiting. */
export async function getOpenFinding(client: Queryable, orgId: string, findingId: string): Promise<(Finding & { documentId: string; documentName: string; assetId: string }) | null> {
  const { rows } = await client.query(
    `select f.document_id::text as document_id, d.name as document_name, d.asset_id::text as asset_id
     from document_findings f join documents d on d.id = f.document_id
     where f.id = $1 and f.org_id = $2 and f.outcome = 'decision' and f.decision is null and d.asset_id is not null
     for update of f`,
    [findingId, orgId],
  )
  if (rows.length === 0) return null
  const finding = (await listFindings(client, orgId, rows[0].document_id)).find((candidate) => candidate.id === findingId)
  return finding ? { ...finding, documentId: rows[0].document_id, documentName: rows[0].document_name, assetId: rows[0].asset_id } : null
}

/**
 * Settles a finding that was waiting for a person: use the document's value
 * (it becomes the golden record, with a history row), or keep the current one.
 * `field` is the finding's field as the organization sees it now.
 */
export async function decideFinding(
  client: Queryable,
  orgId: string,
  userId: string,
  finding: Finding & { documentName: string },
  field: FieldDefinition,
  accept: boolean,
): Promise<Result> {
  if (accept) {
    const golden = await readGolden(client, orgId, finding.recordType, finding.recordId, field, finding.period)
    const allFields = field.dataType === 'picklist' ? await listFields(client, orgId) : []
    if (field.dependsOn && field.dataType === 'picklist' && finding.value.text && !sameValue(golden.value, finding.value)) {
      const problem = await dependentProblem(client, orgId, allFields, field, finding.recordType, finding.recordId, finding.value.text)
      if (problem) return { ok: false, error: problem }
    }
    if (!sameValue(golden.value, finding.value)) {
      await writeGolden(
        client, orgId, userId,
        { recordType: finding.recordType, recordId: finding.recordId, field, period: finding.period },
        golden, finding.value, finding.confidence,
        finding.basis === 'calculated'
          ? `${calculatedNote(finding.documentName, finding.page, finding.quote).slice(0, 1900)}; chosen in review`
          : `${sourceNote(finding.documentName, finding.page)}; chosen in review`,
        finding.basis === 'calculated' ? 'calculated' : 'documents',
      )
      if (field.dataType === 'picklist') await clearMisfitDependents(client, orgId, userId, allFields, field, finding.recordType, finding.recordId)
    }
  }
  await client.query(
    `update document_findings set decision = $3, decided_by = $4, decided_at = now() where id = $1 and org_id = $2`,
    [finding.id, orgId, accept ? 'accepted' : 'rejected', userId],
  )
  return { ok: true }
}

/** One proposed field that is still waiting, with its document. */
export async function getOpenProposal(client: Queryable, orgId: string, proposalId: string): Promise<(Proposal & { documentId: string; documentName: string; assetId: string }) | null> {
  const { rows } = await client.query(
    `select p.document_id::text as document_id, d.name as document_name, d.asset_id::text as asset_id
     from field_proposals p join documents d on d.id = p.document_id
     where p.id = $1 and p.org_id = $2 and p.status = 'proposed' and d.asset_id is not null
     for update of p`,
    [proposalId, orgId],
  )
  if (rows.length === 0) return null
  const proposal = (await listProposals(client, orgId, rows[0].document_id)).find((candidate) => candidate.id === proposalId)
  return proposal ? { ...proposal, documentId: rows[0].document_id, documentName: rows[0].document_name, assetId: rows[0].asset_id } : null
}

/** Marks a proposed field as added (with the field made from it) or dismissed. */
export async function settleProposal(client: Queryable, orgId: string, userId: string, proposalId: string, fieldId: string | null): Promise<void> {
  await client.query(
    `update field_proposals set status = $3, field_id = $4, decided_by = $5, decided_at = now() where id = $1 and org_id = $2`,
    [proposalId, orgId, fieldId ? 'added' : 'dismissed', fieldId, userId],
  )
}

/**
 * Writes the first value of a field that was just added from a proposal, as
 * the golden record with Documents as its source.
 */
export async function fillFromProposal(
  client: Queryable,
  orgId: string,
  userId: string,
  proposal: Proposal & { documentId: string; documentName: string },
  field: FieldDefinition,
  value: StoredValue,
): Promise<void> {
  if (isEmptyValue(value)) return
  const golden = await readGolden(client, orgId, proposal.recordType, proposal.recordId, field, null)
  await client.query(
    `insert into field_source_values
       (org_id, record_type, record_id, field_id, period, source_type, value_text, value_number, value_date, value_bool, received_by, document_id, page)
     values ($1, $2, $3, $4, null, 'documents', $5, $6::numeric, $7::date, $8::boolean, $9, $10, $11)`,
    [orgId, proposal.recordType, proposal.recordId, field.id, value.text, value.number, value.date, value.bool, userId, proposal.documentId, proposal.page],
  )
  await writeGolden(
    client, orgId, userId,
    { recordType: proposal.recordType, recordId: proposal.recordId, field, period: null },
    golden, value, null, `${sourceNote(proposal.documentName, proposal.page)}; field added from the review list`,
  )
}
