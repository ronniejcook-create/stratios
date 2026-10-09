import { withOrg } from '@/lib/db'
import { describeFailure, fail, getCaller, json, NO_PERMISSION, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { CHUNK_BYTES, createDocument } from '@/lib/documents'
import { loadAccess } from '@/lib/permissions'
import { isUuid } from '@/lib/records'

/** Starts an upload. The file itself follows in pieces (see chunks/[index]). */
export async function POST(request: Request) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const body = (await request.json().catch(() => null)) as { assetId?: unknown; name?: unknown; size?: unknown; type?: unknown } | null
  const assetId = String(body?.assetId ?? '')
  if (!body || !isUuid(assetId)) return fail('That asset could not be found.')

  try {
    const result = await withOrg(caller.orgId, async (client) => {
      const access = await loadAccess(client, caller.orgId, caller.userId, caller.isAdmin)
      if (!access.canAddRecords) return { ok: false as const, error: NO_PERMISSION }
      return createDocument(client, caller.orgId, caller.userId, {
        assetId,
        name: String(body.name ?? ''),
        sizeBytes: Number(body.size),
        contentType: String(body.type ?? ''),
      })
    })
    if (!result.ok) return fail(result.error)
    return json({ ok: true, id: result.id, chunkCount: result.chunkCount, chunkBytes: CHUNK_BYTES })
  } catch (error) {
    console.error('Starting an upload failed', error)
    return fail(describeFailure(error, 'The upload could not be started. Try again.'), 500)
  }
}
