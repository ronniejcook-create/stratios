import { withOrg } from '@/lib/db'
import { jobsProfile } from '@/lib/jobs'
import { fail, getCaller, json, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { getAddress, isUuid } from '@/lib/records'

// The EPA's and the Census Bureau's services are asked at once; a slow day there can take several seconds.
export const maxDuration = 60

/**
 * Jobs and commuting around one of the organization's addresses: the jobs
 * located within a few miles, and how the people living there get to work.
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
    console.error('Reading an address for jobs and commuting failed', error)
    return fail('That address could not be read. Try again.', 500)
  }
  if (!address) return fail('That address could not be found.', 404)
  if (address.latitude === null || address.longitude === null) return fail('This address has no map location yet.', 400)

  const result = await jobsProfile(address.latitude, address.longitude)
  if (!result.ok) return fail(result.error, 502)
  return json({ ok: true, profile: result.profile })
}
