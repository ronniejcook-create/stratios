'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { isMissingSchema, withOrg } from '@/lib/db'
import { loadAccess } from '@/lib/permissions'
import { isUuid } from '@/lib/records'
import { answerTenantQuestion, syncAsset, tenantsReady } from '@/lib/tenants'

export type TenantActionResult = { ok: true; message: string } | { ok: false; error: string }

const NO_PERMISSION = "Your role doesn't allow this. Ask an administrator for a role that can edit."
const NEEDS_UPDATE = 'Tenants and leases need a database update: run db/migrations/024_tenants_and_leases.sql, then try again.'

/**
 * Answers whether a name in a rent roll is an existing tenant. "Same" keeps
 * the spelling as another name of that tenant; "different" makes a new
 * tenant. Either way the rows that were waiting get their tenant and leases.
 */
export async function answerTenant(input: { questionId: string; same: boolean; assetId?: string | null }): Promise<TenantActionResult> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  if (!isUuid(input.questionId)) return { ok: false, error: 'That name could not be found.' }
  try {
    const result = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      if (!access.canAddRecords) return { ok: false as const, error: NO_PERMISSION }
      const answered = await answerTenantQuestion(client, orgId, userId, input.questionId, input.same === true)
      if (!answered) return { ok: false as const, error: 'That name has already been answered. Reload the page.' }
      return { ok: true as const, message: input.same === true ? `Recorded as ${answered.tenantName}.` : `${answered.tenantName} was added as a new tenant.` }
    })
    if (!result.ok) return result
    if (input.assetId && isUuid(input.assetId)) revalidatePath(`/dashboard/assets/${input.assetId}`)
    revalidatePath('/dashboard/tenants')
    return result
  } catch (error) {
    console.error('answerTenant failed', error)
    return { ok: false, error: isMissingSchema(error) ? NEEDS_UPDATE : 'That could not be saved. Try again.' }
  }
}

/**
 * Builds, or brings up to date, the units, tenants and leases of every rent
 * roll of an asset. Used once for rent rolls loaded before tenants existed,
 * and safe to press at any time after.
 */
export async function rebuildLeases(input: { assetId: string }): Promise<TenantActionResult> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  if (!isUuid(input.assetId)) return { ok: false, error: 'That asset could not be found.' }
  try {
    const result = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      if (!access.canAddRecords) return { ok: false as const, error: NO_PERMISSION }
      if (!(await tenantsReady(client))) return { ok: false as const, error: NEEDS_UPDATE }
      const built = await syncAsset(client, orgId, userId, input.assetId)
      const parts = [
        built.units > 0 ? `${built.units} ${built.units === 1 ? 'unit' : 'units'}` : '',
        built.tenants > 0 ? `${built.tenants} ${built.tenants === 1 ? 'tenant' : 'tenants'}` : '',
        built.leases > 0 ? `${built.leases} ${built.leases === 1 ? 'lease' : 'leases'}` : '',
      ].filter(Boolean)
      const waiting = built.questions > 0 ? ` ${built.questions === 1 ? '1 name needs' : `${built.questions} names need`} confirming above.` : ''
      return { ok: true as const, message: `${parts.length > 0 ? `Added ${parts.join(', ')}.` : 'Everything is up to date.'}${waiting}` }
    })
    if (!result.ok) return result
    revalidatePath(`/dashboard/assets/${input.assetId}`)
    revalidatePath('/dashboard/tenants')
    return result
  } catch (error) {
    console.error('rebuildLeases failed', error)
    return { ok: false, error: isMissingSchema(error) ? NEEDS_UPDATE : 'The leases could not be built. Try again.' }
  }
}
