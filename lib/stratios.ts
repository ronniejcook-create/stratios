// Which organization is Stratios itself.
//
// Its administrators manage the master library: the standard fields, screens,
// sections and lists that every organization starts from. An organization is
// Stratios when its verified company domain is stratios.app, or when its id is
// named in the STRATIOS_ORG_ID setting on the server. It is never decided by
// the organization's name.

import { getOrgSettings } from './orgSettings'

export const STRATIOS_DOMAIN = 'stratios.app'

export async function isStratiosOrg(orgId: string): Promise<boolean> {
  const configured = process.env.STRATIOS_ORG_ID?.trim()
  if (configured && configured === orgId) return true
  try {
    const settings = await getOrgSettings(orgId)
    return settings.domain === STRATIOS_DOMAIN
  } catch (error) {
    console.error('isStratiosOrg failed', error)
    return false
  }
}

/** True for an administrator of the Stratios organization. */
export async function isStratiosAdmin(orgId: string | null | undefined, orgRole: string | null | undefined): Promise<boolean> {
  if (!orgId || orgRole !== 'org:admin') return false
  return isStratiosOrg(orgId)
}
