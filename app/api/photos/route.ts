import { revalidatePath } from 'next/cache'
import { withOrg } from '@/lib/db'
import { fail, getCaller, json, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { isMissingSchema } from '@/lib/db'
import { loadAccess } from '@/lib/permissions'
import { addUploadedPhoto, MAX_PHOTO_BYTES, PHOTO_TYPES } from '@/lib/photos'
import { isUuid, recordExists } from '@/lib/records'

/** What kind of picture the bytes really are, whatever the browser claimed. */
function sniff(data: Buffer): string | null {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (data.length > 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

const size = (value: string | null) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 && number < 100000 ? number : null
}

/**
 * Adds a photo a person uploaded to an asset. The browser shrinks the picture
 * first and sends it as the request body; the asset, file name and size come
 * in the address. Needs the same permission as adding a document.
 */
export async function POST(request: Request) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const url = new URL(request.url)
  const assetId = url.searchParams.get('assetId') ?? ''
  if (!isUuid(assetId)) return fail('That asset could not be found.', 404)
  if (Number(request.headers.get('content-length') ?? 0) > MAX_PHOTO_BYTES) return fail('That photo is too large.', 413)

  const data = Buffer.from(await request.arrayBuffer())
  if (data.length > MAX_PHOTO_BYTES) return fail('That photo is too large.', 413)
  const contentType = sniff(data)
  if (!contentType || !(PHOTO_TYPES as readonly string[]).includes(contentType)) return fail('Photos must be JPEG, PNG or WebP pictures.', 400)

  try {
    const result = await withOrg(caller.orgId, async (client) => {
      const access = await loadAccess(client, caller.orgId, caller.userId, caller.isAdmin)
      if (!access.canAddRecords) return { ok: false as const, error: "You don't have permission to add photos. Ask an administrator for a role that can edit.", status: 403 }
      if (!(await recordExists(client, caller.orgId, 'asset', assetId))) return { ok: false as const, error: 'That asset could not be found.', status: 404 }
      const added = await addUploadedPhoto(client, caller.orgId, caller.userId, {
        assetId,
        data,
        contentType,
        fileName: url.searchParams.get('name'),
        width: size(url.searchParams.get('width')),
        height: size(url.searchParams.get('height')),
      })
      return added.ok ? added : { ...added, status: 400 }
    })
    if (!result.ok) return fail(result.error, result.status)
    revalidatePath(`/dashboard/assets/${assetId}`)
    revalidatePath('/dashboard')
    return json({ ok: true, id: result.id })
  } catch (error) {
    console.error('Adding a photo failed', error)
    return fail(isMissingSchema(error) ? 'Photos need a database update: run db/migrations/013_photos.sql.' : 'The photo could not be saved. Try again.', 500)
  }
}
