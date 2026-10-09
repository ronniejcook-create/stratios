import { withOrg } from '@/lib/db'
import { fail, getCaller, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { getDocument, readDocumentFile } from '@/lib/documents'
import { loadAccess } from '@/lib/permissions'
import { isUuid } from '@/lib/records'

const SLICE = 256 * 1024

/**
 * Opens the original file in the browser. A document can hold values for
 * fields a person is not allowed to see, so only people who may add documents
 * (administrators and roles that can edit) can open it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const { id } = await params
  if (!isUuid(id)) return fail('That document could not be found.', 404)

  let loaded
  try {
    loaded = await withOrg(caller.orgId, async (client) => {
      const access = await loadAccess(client, caller.orgId, caller.userId, caller.isAdmin)
      if (!access.canAddRecords) return null
      const document = await getDocument(client, caller.orgId, id)
      if (!document || document.status === 'uploading') return null
      const file = await readDocumentFile(client, caller.orgId, id)
      return file ? { document, file } : null
    })
  } catch (error) {
    console.error('Opening a document failed', error)
    return fail('The document could not be opened. Try again.', 500)
  }
  if (!loaded) return fail('That document could not be found.', 404)
  const { document, file } = loaded

  // Sent as a stream of small slices, which the web host allows for files larger than one ordinary response.
  let offset = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= file.length) {
        controller.close()
        return
      }
      controller.enqueue(new Uint8Array(file.subarray(offset, offset + SLICE)))
      offset += SLICE
    },
  })
  const asciiName = document.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')
  return new Response(stream, {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(file.length),
      'content-disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(document.name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
