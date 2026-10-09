import { withOrg } from '@/lib/db'
import { fail, getCaller, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { getPhotoFile } from '@/lib/photos'
import { isUuid } from '@/lib/records'

/**
 * Shows one photo. Anyone in the organization who can open the asset can see
 * its photos; the organization always comes from the signed-in session.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const { id } = await params
  if (!isUuid(id)) return fail('That photo could not be found.', 404)

  let photo
  try {
    photo = await withOrg(caller.orgId, (client) => getPhotoFile(client, caller.orgId, id))
  } catch (error) {
    console.error('Opening a photo failed', error)
    return fail('The photo could not be opened. Try again.', 500)
  }
  if (!photo) return fail('That photo could not be found.', 404)

  return new Response(new Uint8Array(photo.data), {
    headers: {
      'content-type': photo.contentType,
      'content-length': String(photo.data.length),
      // A photo never changes once saved, so the browser may keep its copy; "private" keeps it out of shared caches.
      'cache-control': 'private, max-age=86400, immutable',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
    },
  })
}
