'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth, clerkClient } from '@clerk/nextjs/server'

const ROLES = ['org:member', 'org:admin'] as const
type Role = (typeof ROLES)[number]

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}

/** Returns the signed-in admin's organization, or null if they may not manage members. */
async function requireAdmin() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId || orgRole !== 'org:admin') return null
  return { userId, orgId }
}

export type InviteState = { error: string | null; sentTo: string | null }

export async function inviteMember(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const admin = await requireAdmin()
  if (!admin) return { error: 'Only administrators can invite people.', sentTo: null }

  const emailAddress = String(formData.get('email') ?? '').trim().toLowerCase()
  const role = String(formData.get('role') ?? '')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) return { error: 'Enter a valid email address.', sentTo: null }
  if (!isRole(role)) return { error: 'Choose a role.', sentTo: null }

  // The link in the invitation email comes back to this site.
  const requestHeaders = await headers()
  const host = requestHeaders.get('host')
  const origin = requestHeaders.get('origin') ?? (host ? `http://${host}` : null)

  try {
    const client = await clerkClient()
    await client.organizations.createOrganizationInvitation({
      organizationId: admin.orgId,
      emailAddress,
      role,
      inviterUserId: admin.userId,
      ...(origin ? { redirectUrl: `${origin}/accept-invitation` } : {}),
    })
  } catch (error) {
    console.error('inviteMember failed', error)
    return { error: 'The invitation could not be sent. They may already be a member or have a pending invitation.', sentTo: null }
  }

  revalidatePath('/dashboard/members')
  return { error: null, sentTo: emailAddress }
}

async function run(task: (admin: { userId: string; orgId: string }) => Promise<void>) {
  const admin = await requireAdmin()
  if (!admin) redirect('/dashboard/members?error=not-admin')
  try {
    await task(admin)
  } catch (error) {
    console.error('member action failed', error)
    redirect('/dashboard/members?error=failed')
  }
  revalidatePath('/dashboard/members')
  redirect('/dashboard/members')
}

export async function changeRole(formData: FormData): Promise<void> {
  const targetUserId = String(formData.get('userId') ?? '')
  const role = String(formData.get('role') ?? '')
  await run(async ({ userId, orgId }) => {
    if (!targetUserId || !isRole(role)) throw new Error('Invalid request')
    if (targetUserId === userId) throw new Error('You cannot change your own role')
    const client = await clerkClient()
    await client.organizations.updateOrganizationMembership({ organizationId: orgId, userId: targetUserId, role })
  })
}

export async function removeMember(formData: FormData): Promise<void> {
  const targetUserId = String(formData.get('userId') ?? '')
  await run(async ({ userId, orgId }) => {
    if (!targetUserId) throw new Error('Invalid request')
    if (targetUserId === userId) throw new Error('You cannot remove yourself')
    const client = await clerkClient()
    await client.organizations.deleteOrganizationMembership({ organizationId: orgId, userId: targetUserId })
  })
}

export async function revokeInvitation(formData: FormData): Promise<void> {
  const invitationId = String(formData.get('invitationId') ?? '')
  await run(async ({ userId, orgId }) => {
    if (!invitationId) throw new Error('Invalid request')
    const client = await clerkClient()
    await client.organizations.revokeOrganizationInvitation({ organizationId: orgId, invitationId, requestingUserId: userId })
  })
}
