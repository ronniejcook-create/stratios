'use server'

import { revalidatePath } from 'next/cache'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { withOrg } from '@/lib/db'
import { createRole, deleteRole, isLevel, saveRules, setRoleMembers, updateRole, type Level } from '@/lib/permissions'
import { isUuid } from '@/lib/records'

// Only administrators manage roles and permissions. The organization always
// comes from the signed-in session.
async function requireAdmin() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId || orgRole !== 'org:admin') return null
  return { userId, orgId }
}

const NOT_ADMIN = 'Only administrators can change roles and permissions.'

export type RoleFormState = { error: string | null; message: string | null; done: number }
export type RoleResult = { ok: true; message: string } | { ok: false; error: string }

export async function addRole(prev: RoleFormState, formData: FormData): Promise<RoleFormState> {
  const admin = await requireAdmin()
  if (!admin) return { error: NOT_ADMIN, message: null, done: prev.done }
  try {
    const result = await withOrg(admin.orgId, (client) =>
      createRole(client, admin.orgId, admin.userId, String(formData.get('name') ?? ''), String(formData.get('defaultLevel') ?? '')),
    )
    if (!result.ok) return { error: result.error, message: null, done: prev.done }
  } catch (error) {
    console.error('addRole failed', error)
    return { error: 'The role could not be added. Try again.', message: null, done: prev.done }
  }
  revalidatePath('/dashboard/roles')
  return { error: null, message: 'Role added. Open it to choose its people and its access.', done: prev.done + 1 }
}

export async function saveRole(input: { roleId: string; name: string; defaultLevel: string }): Promise<RoleResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: NOT_ADMIN }
  if (!isUuid(input.roleId)) return { ok: false, error: 'That role could not be found.' }
  try {
    const result = await withOrg(admin.orgId, (client) => updateRole(client, admin.orgId, input.roleId, String(input.name ?? ''), String(input.defaultLevel ?? '')))
    if (!result.ok) return result
  } catch (error) {
    console.error('saveRole failed', error)
    return { ok: false, error: 'The role could not be saved. Try again.' }
  }
  revalidatePath('/dashboard/roles')
  revalidatePath(`/dashboard/roles/${input.roleId}`)
  return { ok: true, message: 'Role saved.' }
}

export async function removeRole(input: { roleId: string }): Promise<RoleResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: NOT_ADMIN }
  if (!isUuid(input.roleId)) return { ok: false, error: 'That role could not be found.' }
  try {
    const result = await withOrg(admin.orgId, (client) => deleteRole(client, admin.orgId, input.roleId))
    if (!result.ok) return result
  } catch (error) {
    console.error('removeRole failed', error)
    return { ok: false, error: 'The role could not be removed. Try again.' }
  }
  revalidatePath('/dashboard/roles')
  return { ok: true, message: 'Role removed.' }
}

/** Sets exactly which people hold a role. Only current members of the organization are accepted. */
export async function saveRolePeople(input: { roleId: string; userIds: string[] }): Promise<RoleResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: NOT_ADMIN }
  if (!isUuid(input.roleId) || !Array.isArray(input.userIds)) return { ok: false, error: 'That role could not be found.' }
  try {
    const client = await clerkClient()
    const memberships = await client.organizations.getOrganizationMembershipList({ organizationId: admin.orgId, limit: 500 })
    const members = new Set(memberships.data.map((membership) => membership.publicUserData?.userId).filter((id): id is string => Boolean(id)))
    const userIds = input.userIds.map((id) => String(id)).filter((id) => members.has(id))
    const result = await withOrg(admin.orgId, (db) => setRoleMembers(db, admin.orgId, admin.userId, input.roleId, userIds))
    if (!result.ok) return result
  } catch (error) {
    console.error('saveRolePeople failed', error)
    return { ok: false, error: 'The people could not be saved. Try again.' }
  }
  revalidatePath('/dashboard/roles')
  revalidatePath(`/dashboard/roles/${input.roleId}`)
  return { ok: true, message: 'People saved.' }
}

/** Replaces a role's section and field rules. An empty choice means "follow the default". */
export async function saveRoleRules(input: { roleId: string; sections: Record<string, string>; fields: Record<string, string> }): Promise<RoleResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: NOT_ADMIN }
  if (!isUuid(input.roleId)) return { ok: false, error: 'That role could not be found.' }
  const clean = (raw: Record<string, string> | undefined) => {
    const rules: Record<string, Level> = {}
    for (const [id, level] of Object.entries(raw ?? {})) {
      if (isUuid(id) && isLevel(level)) rules[id] = level
    }
    return rules
  }
  try {
    const result = await withOrg(admin.orgId, (client) => saveRules(client, admin.orgId, input.roleId, { sections: clean(input.sections), fields: clean(input.fields) }))
    if (!result.ok) return result
  } catch (error) {
    console.error('saveRoleRules failed', error)
    return { ok: false, error: 'The access rules could not be saved. Try again.' }
  }
  revalidatePath(`/dashboard/roles/${input.roleId}`)
  return { ok: true, message: 'Access saved.' }
}
