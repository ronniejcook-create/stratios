import { revalidatePath } from 'next/cache'
import { describeCashFlow, loadCashFlow } from '@/lib/cashFlowReading'
import { fail, getCaller, json, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { isUuid } from '@/lib/records'

// One question to Claude, with the whole statement in its answer.
export const maxDuration = 300

/**
 * Copies the operating statement in a document, line by line and month by
 * month, and saves it as a cash flow on the document's asset (see
 * lib/cashFlowReading.ts). Asked for by the browser after a document that
 * holds a statement has been read, and by Load From a Document on the Cash
 * Flow tab.
 */
export async function POST(request: Request) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const body = (await request.json().catch(() => null)) as { documentId?: unknown } | null
  const documentId = typeof body?.documentId === 'string' ? body.documentId : ''
  if (!isUuid(documentId)) return fail('That document could not be found.', 404)

  const result = await loadCashFlow(caller, documentId)
  if (!result.ok) return fail(result.error, result.status)
  revalidatePath(`/dashboard/assets/${result.assetId}`)
  return json({ ok: true, found: result.found, cashFlowId: result.found ? result.cashFlowId : null, message: describeCashFlow(result) })
}
