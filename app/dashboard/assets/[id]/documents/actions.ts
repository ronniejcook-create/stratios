'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { withOrg } from '@/lib/db'
import { decideFinding, fillFromProposal, getDocument, getOpenFinding, getOpenProposal, removeDocument, settleProposal } from '@/lib/documents'
import { createField } from '@/lib/fieldAdmin'
import { parseInput } from '@/lib/fieldFormat'
import { listFields } from '@/lib/fields'
import { loadAccess, sectionOfField } from '@/lib/permissions'
import { isUuid } from '@/lib/records'

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

const NOT_SIGNED_IN = 'You need to be signed in to an organization.'
const GONE = 'That item has already been dealt with. Reload the page.'

function refresh(assetId: string, documentId: string) {
  revalidatePath(`/dashboard/assets/${assetId}`)
  revalidatePath(`/dashboard/assets/${assetId}/documents/${documentId}`)
  revalidatePath('/dashboard')
}

/** Settles a value that was waiting for a person: use the document's value, or keep the current one. */
export async function decideValue(input: { findingId: string; accept: boolean }): Promise<ActionResult> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: NOT_SIGNED_IN }
  if (!isUuid(input.findingId)) return { ok: false, error: GONE }
  try {
    const result = await withOrg(orgId, async (client) => {
      const finding = await getOpenFinding(client, orgId, input.findingId)
      if (!finding) return { ok: false as const, error: GONE }
      // The person must be allowed to change this field, exactly as on the asset page.
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      const level = access.fieldLevel(finding.fieldId, await sectionOfField(client, orgId, finding.fieldId))
      if (level !== 'edit') return { ok: false as const, error: "You don't have permission to change this field." }
      const field = (await listFields(client, orgId)).find((candidate) => candidate.id === finding.fieldId)
      if (!field) return { ok: false as const, error: 'That field no longer exists.' }
      const decided = await decideFinding(client, orgId, userId, finding, field, input.accept === true)
      return decided.ok ? { ok: true as const, assetId: finding.assetId, documentId: finding.documentId, fieldName: field.name } : decided
    })
    if (!result.ok) return result
    refresh(result.assetId, result.documentId)
    return { ok: true, message: input.accept === true ? `${result.fieldName} now uses the document's value.` : `${result.fieldName} was left as it was.` }
  } catch (error) {
    console.error('decideValue failed', error)
    return { ok: false, error: 'That choice could not be saved. Try again.' }
  }
}

/**
 * Adds a field the agent proposed (administrators only) and fills in the
 * value it found, or dismisses the proposal.
 */
export async function settleProposedField(input: { proposalId: string; add: boolean }): Promise<ActionResult> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: NOT_SIGNED_IN }
  if (orgRole !== 'org:admin') return { ok: false, error: 'Only administrators can add or dismiss proposed fields.' }
  if (!isUuid(input.proposalId)) return { ok: false, error: GONE }
  try {
    const result = await withOrg(orgId, async (client) => {
      const proposal = await getOpenProposal(client, orgId, input.proposalId)
      if (!proposal) return { ok: false as const, error: GONE }
      const done = { ok: true as const, assetId: proposal.assetId, documentId: proposal.documentId, message: undefined as string | undefined }
      if (input.add !== true) {
        await settleProposal(client, orgId, userId, proposal.id, null)
        done.message = `${proposal.name} was dismissed. No field was added.`
        return done
      }
      const created = await createField(client, orgId, {
        name: proposal.name,
        appliesTo: proposal.recordType,
        dataType: proposal.dataType,
        unit: '',
        options: [],
        tracking: 'single',
        sectionId: null,
        listId: null,
        aiDescription: proposal.reason ?? '',
      })
      if (!created.ok) return created
      const field = (await listFields(client, orgId)).find((candidate) => candidate.id === created.id)
      if (!field) throw new Error('The new field could not be read back')
      const raw = proposal.dataType === 'boolean' ? (/^(yes|true|y)$/i.test(proposal.value) ? 'yes' : /^(no|false|n)$/i.test(proposal.value) ? 'no' : proposal.value) : proposal.value
      const parsed = parseInput(field, raw)
      if (parsed.ok) await fillFromProposal(client, orgId, userId, proposal, field, parsed.value)
      await settleProposal(client, orgId, userId, proposal.id, field.id)
      done.message = parsed.ok
        ? `${field.name} was added and filled in. It shows under Other Fields until you place it in a section.`
        : `${field.name} was added, but "${proposal.value}" did not fit its type, so enter the value by hand.`
      return done
    })
    if (!result.ok) return result
    refresh(result.assetId, result.documentId)
    revalidatePath('/dashboard/fields')
    return { ok: true, message: result.message }
  } catch (error) {
    console.error('settleProposedField failed', error)
    return { ok: false, error: 'That could not be saved. Try again.' }
  }
}

/** Removes a document and its review list. Administrators, or the person who uploaded it. */
export async function deleteDocument(input: { documentId: string }): Promise<ActionResult> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: NOT_SIGNED_IN }
  if (!isUuid(input.documentId)) return { ok: false, error: 'That document could not be found.' }
  try {
    const result = await withOrg(orgId, async (client) => {
      const document = await getDocument(client, orgId, input.documentId)
      if (!document) return { ok: false as const, error: 'That document could not be found.' }
      if (orgRole !== 'org:admin' && document.uploadedBy !== userId) return { ok: false as const, error: 'Only an administrator or the person who uploaded it can remove a document.' }
      await removeDocument(client, orgId, document.id)
      return { ok: true as const, assetId: document.assetId }
    })
    if (!result.ok) return result
    if (result.assetId) revalidatePath(`/dashboard/assets/${result.assetId}`)
    return { ok: true }
  } catch (error) {
    console.error('deleteDocument failed', error)
    return { ok: false, error: 'The document could not be removed. Try again.' }
  }
}
