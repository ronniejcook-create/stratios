import { revalidatePath } from 'next/cache'
import { withOrg } from '@/lib/db'
import { describeFailure, fail, getCaller, json, NO_PERMISSION, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { applyReading, failReading, getDocument, readDocumentFile, startReading } from '@/lib/documents'
import { extractableFields, readDocument, sectionByField } from '@/lib/extraction'
import { listFields } from '@/lib/fields'
import { listScreens } from '@/lib/layout'
import { loadAccess } from '@/lib/permissions'
import { getAssetTree, isUuid } from '@/lib/records'

// Reading a long document can take a few minutes.
export const maxDuration = 300

/**
 * Has the extraction agent read a document and applies each field's rules to
 * what it finds. The agent is only given the fields the person asking may
 * change, so it follows the same permissions they have.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const { id } = await params
  if (!isUuid(id)) return fail('That document could not be found.', 404)
  const { orgId, userId } = caller

  let prepared
  try {
    // Step 1 (its own short transaction): claim the document and gather what the agent needs.
    prepared = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, caller.isAdmin)
      if (!access.canAddRecords) return { ok: false as const, error: NO_PERMISSION, status: 403 }
      const document = await getDocument(client, orgId, id)
      if (!document || document.status === 'uploading') return { ok: false as const, error: 'That document could not be found.', status: 404 }
      if (!(await startReading(client, orgId, userId, id))) {
        return {
          ok: false as const,
          status: 409,
          error: document.status === 'read' ? 'This document has already been read.' : 'This document is being read right now. Give it a few minutes.',
        }
      }
      const tree = await getAssetTree(client, orgId, document.assetId)
      const file = await readDocumentFile(client, orgId, id)
      if (!tree || !file) return { ok: true as const, document, tree: null, file: null, fields: [] }
      const fields = extractableFields(await listFields(client, orgId), sectionByField(await listScreens(client, orgId)), access.fieldLevel)
      return { ok: true as const, document, tree, file, fields }
    })
  } catch (error) {
    console.error('Preparing to read a document failed', error)
    return fail(describeFailure(error, 'The document could not be opened. Try again.'), 500)
  }
  if (!prepared.ok) return fail(prepared.error, prepared.status)
  const { document } = prepared

  const giveUp = async (error: string, status = 502) => {
    await withOrg(orgId, (client) => failReading(client, orgId, id, error)).catch((failure) => console.error('Recording a failed reading failed', failure))
    revalidatePath(`/dashboard/assets/${document.assetId}`)
    return fail(error, status)
  }
  if (!prepared.tree || !prepared.file) return giveUp('The file for this document is missing. Upload it again.', 500)

  // Step 2 (no transaction held): the agent reads the document.
  const result = await readDocument({ file: prepared.file, documentName: document.name, tree: prepared.tree, fields: prepared.fields })
  if (!result.ok) return giveUp(result.error)

  // Step 3: apply the rules and build the review list.
  try {
    const counts = await withOrg(orgId, (client) => applyReading(client, orgId, userId, { id, name: document.name }, result.reading))
    revalidatePath(`/dashboard/assets/${document.assetId}`)
    revalidatePath('/dashboard')
    return json({ ok: true, counts, proposals: result.reading.proposals.length, skipped: result.reading.skipped })
  } catch (error) {
    console.error('Applying a reading failed', error)
    return giveUp(describeFailure(error, 'The findings could not be saved. Try reading the document again.'), 500)
  }
}
