import { revalidatePath } from 'next/cache'
import { fail, getCaller, json, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { readIntoLease } from '@/lib/documentReading'
import { isUuid } from '@/lib/records'

// Reading a long lease can take a few minutes.
export const maxDuration = 300

/**
 * Has the agent read an uploaded lease agreement (or amendment) into one
 * lease: its fields are filled by the usual rules and review list, and its
 * critical dates are added to the property (see readIntoLease).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { documentId?: unknown } | null
  const documentId = typeof body?.documentId === 'string' ? body.documentId : ''
  if (!isUuid(id) || !isUuid(documentId)) return fail('That lease could not be found.', 404)

  const result = await readIntoLease(caller, documentId, id)
  if (!result.ok) return fail(result.error, result.status)
  revalidatePath(`/dashboard/leases/${id}`)
  revalidatePath(`/dashboard/assets/${result.assetId}`)
  return json({ ok: true, assetId: result.assetId, counts: result.counts, skipped: result.skipped, listRows: result.listRows })
}
