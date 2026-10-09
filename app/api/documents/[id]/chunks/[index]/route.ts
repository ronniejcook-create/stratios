import { withOrg } from '@/lib/db'
import { describeFailure, fail, getCaller, json, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { CHUNK_BYTES, saveChunk } from '@/lib/documents'
import { isUuid } from '@/lib/records'

/** Receives one piece of a file. Only the person who started the upload can add to it. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const { id, index: rawIndex } = await params
  const index = Number(rawIndex)
  if (!isUuid(id) || !/^\d{1,4}$/.test(rawIndex)) return fail('That upload could not be found.', 404)
  if (Number(request.headers.get('content-length') ?? 0) > CHUNK_BYTES) return fail('That piece is too large.', 413)

  const data = Buffer.from(await request.arrayBuffer())
  if (data.length === 0 || data.length > CHUNK_BYTES) return fail('That piece is the wrong size.')
  try {
    const result = await withOrg(caller.orgId, (client) => saveChunk(client, caller.orgId, caller.userId, id, index, data))
    return result.ok ? json({ ok: true }) : fail(result.error)
  } catch (error) {
    console.error('Saving an upload piece failed', error)
    return fail(describeFailure(error, 'Part of the file could not be saved. Try again.'), 500)
  }
}
