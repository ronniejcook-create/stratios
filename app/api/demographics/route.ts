import { withOrg } from '@/lib/db'
import { areaProfile } from '@/lib/demographics'
import { fail, getCaller, json, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { getAddress, isUuid } from '@/lib/records'

// Two Census services are asked in turn; the first time for a place can take several seconds.
export const maxDuration = 60

/**
 * Census figures around one of the organization's addresses: the nearby
 * neighborhoods with their outlines, and totals within 1, 3 and 5 miles.
 * It takes an address, not coordinates, so it can only be asked about places
 * the organization has, and the address is read as the signed-in person.
 */
export async function GET(request: Request) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const addressId = new URL(request.url).searchParams.get('addressId') ?? ''
  if (!isUuid(addressId)) return fail('That address could not be found.', 404)

  let address
  try {
    address = await withOrg(caller.orgId, (client) => getAddress(client, caller.orgId, addressId))
  } catch (error) {
    console.error('Reading an address for demographics failed', error)
    return fail('That address could not be read. Try again.', 500)
  }
  if (!address) return fail('That address could not be found.', 404)
  if (address.latitude === null || address.longitude === null) return fail('This address has no map location yet.', 400)

  const result = await areaProfile(address.latitude, address.longitude)
  if (!result.ok) return fail(result.error, 502)
  return json({ ok: true, profile: result.profile })
}
