import { clerkClient, currentUser } from '@clerk/nextjs/server'
import { getEmailDomain, isPublicEmailDomain } from './domains'

export type OnboardingState =
  // Already a member of, or invited to, an organization.
  | { kind: 'has-organizations' }
  | { kind: 'unverified-email' }
  // Their email domain already belongs to an organization on Stratios.
  | { kind: 'domain-taken'; email: string; domain: string; organizationName: string }
  // New company domain, or a public email provider (domain is null).
  | { kind: 'needs-setup'; email: string; domain: string | null }

/**
 * Finds the organization that registered a company email domain.
 * The domain is stored on the organization's public metadata when it is set up.
 * This scans the organization list, which is fine for a small number of
 * organizations; move it to an indexed database lookup as the list grows.
 */
export async function findOrganizationByDomain(domain: string) {
  const client = await clerkClient()
  const pageSize = 100
  for (let offset = 0; ; offset += pageSize) {
    const page = await client.organizations.getOrganizationList({ limit: pageSize, offset })
    const match = page.data.find((org) => org.publicMetadata?.domain === domain)
    if (match) return match
    if (page.data.length < pageSize) return null
  }
}

/** Works out what a signed-in user without an active organization should see. */
export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const client = await clerkClient()
  const [memberships, invitations] = await Promise.all([
    client.users.getOrganizationMembershipList({ userId, limit: 1 }),
    client.users.getOrganizationInvitationList({ userId, status: 'pending', limit: 1 }),
  ])
  if (memberships.data.length > 0 || invitations.data.length > 0) return { kind: 'has-organizations' }

  const user = await currentUser()
  const primary = user?.primaryEmailAddress
  // Only a verified address proves the person controls an inbox at that domain.
  if (!primary || primary.verification?.status !== 'verified') return { kind: 'unverified-email' }

  const email = primary.emailAddress
  const domain = getEmailDomain(email)
  if (!domain || isPublicEmailDomain(domain)) return { kind: 'needs-setup', email, domain: null }

  const existing = await findOrganizationByDomain(domain)
  if (existing) return { kind: 'domain-taken', email, domain, organizationName: existing.name }

  return { kind: 'needs-setup', email, domain }
}
