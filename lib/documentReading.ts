// Having the agent read a document: into an asset that exists, or into a new
// asset created from the document. Used by the Documents tab and by the chat
// agent, so both follow the same permissions and rules.
//
// Each reading takes three steps, so no database transaction is held open
// while Claude reads: claim the document, read it, then apply what was found.

import { createAssetWithDefaults } from './assets'
import { withOrg } from './db'
import { describeFailure, NO_PERMISSION, type Caller } from './documentRequests'
import { applyReading, attachDocument, failReading, getDocument, readDocumentFile, startReading, type Outcome } from './documents'
import { extractableFields, NEW_RECORDS, newAssetRecords, readDocument, recordsOf, sectionByField } from './extraction'
import { listFields } from './fields'
import { listScreens } from './layout'
import { loadAccess } from './permissions'
import { getAssetTree } from './records'

export type ReadSuccess = {
  ok: true
  assetId: string
  assetName: string
  /** True when the asset was created by this reading. */
  created: boolean
  documentId: string
  documentName: string
  documentType: string | null
  summary: string | null
  counts: Record<Outcome, number>
  proposals: number
  skipped: number
}
export type ReadOutcome = ReadSuccess | { ok: false; error: string; status: number }

const NOT_FOUND = 'That document could not be found.'
const busyMessage = (status: string) =>
  status === 'read' ? 'This document has already been read.' : 'This document is being read right now. Give it a few minutes.'

async function giveUp(caller: Caller, documentId: string, error: string, status = 502): Promise<ReadOutcome> {
  await withOrg(caller.orgId, (client) => failReading(client, caller.orgId, documentId, error)).catch((failure) => console.error('Recording a failed reading failed', failure))
  return { ok: false, error, status }
}

/**
 * Reads a document into an asset that exists. The document must already
 * belong to that asset, or belong to none yet, in which case pass `assetId`
 * to tie it to one. The agent is only given the fields the person may change.
 */
export async function readIntoAsset(caller: Caller, documentId: string, assetId: string | null = null, timeoutMs?: number): Promise<ReadOutcome> {
  const { orgId, userId } = caller
  let prepared
  try {
    prepared = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, caller.isAdmin)
      if (!access.canAddRecords) return { ok: false as const, error: NO_PERMISSION, status: 403 }
      const document = await getDocument(client, orgId, documentId)
      if (!document || document.status === 'uploading') return { ok: false as const, error: NOT_FOUND, status: 404 }
      const targetId = document.assetId ?? assetId
      if (!targetId) return { ok: false as const, error: 'Say which asset this document belongs to.', status: 400 }
      if (assetId && document.assetId && document.assetId !== assetId) return { ok: false as const, error: 'That document already belongs to a different asset.', status: 400 }
      const tree = await getAssetTree(client, orgId, targetId)
      if (!tree) return { ok: false as const, error: 'That asset could not be found.', status: 404 }
      if (!(await startReading(client, orgId, userId, documentId))) return { ok: false as const, error: busyMessage(document.status), status: 409 }
      if (!document.assetId) await attachDocument(client, orgId, documentId, targetId)
      const file = await readDocumentFile(client, orgId, documentId)
      const fields = extractableFields(await listFields(client, orgId), sectionByField(await listScreens(client, orgId)), access.fieldLevel)
      return { ok: true as const, document, tree, file, fields }
    })
  } catch (error) {
    console.error('Preparing to read a document failed', error)
    return { ok: false, error: describeFailure(error, 'The document could not be opened. Try again.'), status: 500 }
  }
  if (!prepared.ok) return prepared
  const { document, tree } = prepared
  if (!prepared.file) return giveUp(caller, documentId, 'The file for this document is missing. Upload it again.', 500)

  const result = await readDocument({ file: prepared.file, documentName: document.name, records: recordsOf(tree), fields: prepared.fields, timeoutMs })
  if (!result.ok) return giveUp(caller, documentId, result.error)

  try {
    const counts = await withOrg(orgId, (client) => applyReading(client, orgId, userId, { id: documentId, name: document.name }, result.reading))
    return {
      ok: true,
      assetId: tree.id,
      assetName: tree.name,
      created: false,
      documentId,
      documentName: document.name,
      documentType: result.reading.documentType,
      summary: result.reading.summary,
      counts,
      proposals: result.reading.proposals.length,
      skipped: result.reading.skipped,
    }
  } catch (error) {
    console.error('Applying a reading failed', error)
    return giveUp(caller, documentId, describeFailure(error, 'The findings could not be saved. Try reading the document again.'), 500)
  }
}

/**
 * Creates an asset from a document that belongs to no asset yet: the agent
 * reads the document once, the asset (with one property and one building) is
 * created from its name, property type and city, and everything else it found
 * goes through the same rules and review list as any other reading.
 */
export async function createAssetFromDocument(caller: Caller, documentId: string, timeoutMs?: number): Promise<ReadOutcome> {
  const { orgId, userId } = caller
  let prepared
  try {
    prepared = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, caller.isAdmin)
      if (!access.canAddRecords) return { ok: false as const, error: "You don't have permission to add assets. Ask an administrator for a role that can edit.", status: 403 }
      const document = await getDocument(client, orgId, documentId)
      if (!document || document.status === 'uploading') return { ok: false as const, error: NOT_FOUND, status: 404 }
      if (document.assetId) return { ok: false as const, error: 'That document already belongs to an asset.', status: 400 }
      if (!(await startReading(client, orgId, userId, documentId))) return { ok: false as const, error: busyMessage(document.status), status: 409 }
      const file = await readDocumentFile(client, orgId, documentId)
      const fields = extractableFields(await listFields(client, orgId), sectionByField(await listScreens(client, orgId)), access.fieldLevel)
      return { ok: true as const, document, file, fields }
    })
  } catch (error) {
    console.error('Preparing to read a document failed', error)
    return { ok: false, error: describeFailure(error, 'The document could not be opened. Try again.'), status: 500 }
  }
  if (!prepared.ok) return prepared
  const { document } = prepared
  if (!prepared.file) return giveUp(caller, documentId, 'The file for this document is missing. Upload it again.', 500)

  const result = await readDocument({ file: prepared.file, documentName: document.name, records: newAssetRecords(), fields: prepared.fields, newAsset: true, timeoutMs })
  if (!result.ok) return giveUp(caller, documentId, result.error)
  const described = result.newAsset
  const name = (described?.name || document.name.replace(/\.pdf$/i, '')).slice(0, 200)

  try {
    return await withOrg(orgId, async (client) => {
      const assetId = await createAssetWithDefaults(client, orgId, userId, { name, propertyType: described?.propertyType ?? 'Other', city: described?.city ?? null })
      const tree = await getAssetTree(client, orgId, assetId)
      const property = tree?.properties[0]
      const building = property?.buildings[0]
      if (!tree || !property || !building) throw new Error('The new asset could not be read back')
      await attachDocument(client, orgId, documentId, assetId)
      // Point everything the agent found at the records that now exist.
      const real: Record<string, string> = { [NEW_RECORDS.asset]: assetId, [NEW_RECORDS.property]: property.id, [NEW_RECORDS.building]: building.id }
      const reading = {
        ...result.reading,
        candidates: result.reading.candidates.map((candidate) => ({ ...candidate, recordId: real[candidate.recordId] ?? candidate.recordId })),
        proposals: result.reading.proposals.map((proposal) => ({ ...proposal, recordId: real[proposal.recordId] ?? proposal.recordId })),
      }
      const counts = await applyReading(client, orgId, userId, { id: documentId, name: document.name }, reading)
      return {
        ok: true as const,
        assetId,
        assetName: tree.name,
        created: true,
        documentId,
        documentName: document.name,
        documentType: reading.documentType,
        summary: reading.summary,
        counts,
        proposals: reading.proposals.length,
        skipped: reading.skipped,
      }
    })
  } catch (error) {
    console.error('Creating an asset from a document failed', error)
    return giveUp(caller, documentId, describeFailure(error, 'The asset could not be created from this document. Try again.'), 500)
  }
}
