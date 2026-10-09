import { withOrg } from '@/lib/db'
import { describeFailure, fail, getCaller, json, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { completeUpload } from '@/lib/documents'
import { isUuid } from '@/lib/records'

/** Finishes an upload once every piece has arrived. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const { id } = await params
  if (!isUuid(id)) return fail('That upload could not be found.', 404)
  try {
    const result = await withOrg(caller.orgId, (client) => completeUpload(client, caller.orgId, caller.userId, id))
    return result.ok ? json({ ok: true }) : fail(result.error)
  } catch (error) {
    console.error('Finishing an upload failed', error)
    return fail(describeFailure(error, 'The upload could not be finished. Try again.'), 500)
  }
}
