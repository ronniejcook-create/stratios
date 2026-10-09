import { withOrg } from '@/lib/db'
import { hazardProfile } from '@/lib/hazards'
import { fail, getCaller, json, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { getAddress, isUuid } from '@/lib/records'

// FEMA's service is asked two questions at once; a slow day there can take several seconds.
export const maxDuration = 60

/**
 * FEMA's natural hazard ratings for one of the organization's addresses: the
 * ratings of its census tract, and of the tracts within a few miles for the map.
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
    console.error('Reading an address for natural hazards failed', error)
    return fail('That address could not be read. Try again.', 500)
  }
  if (!address) return fail('That address could not be found.', 404)
  if (address.latitude === null || address.longitude === null) return fail('This address has no map location yet.', 400)

  const result = await hazardProfile(address.latitude, address.longitude)
  if (!result.ok) return fail(result.error, 502)
  return json({ ok: true, profile: result.profile })
}
