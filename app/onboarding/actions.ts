'use server'

import { after } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { generateBrandTheme, saveOrgTheme } from '@/lib/brandColors'
import { getOnboardingState } from '@/lib/organizations'

export type SetupOrganizationState = { error: string | null; organizationId: string | null }

export async function setupOrganization(
  _prev: SetupOrganizationState,
  formData: FormData,
): Promise<SetupOrganizationState> {
  const { userId } = await auth()
  if (!userId) return { error: 'You need to be signed in.', organizationId: null }

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Enter your organization name.', organizationId: null }
  if (name.length > 100) return { error: 'The name is too long.', organizationId: null }

  try {
    // Re-check on the server: the domain comes from the verified email on the
    // account, never from the form, and may have been claimed since the page loaded.
    const state = await getOnboardingState(userId)
    if (state.kind !== 'needs-setup') {
      return { error: 'This account can no longer set up a new organization. Refresh the page.', organizationId: null }
    }

    const client = await clerkClient()
    const organization = await client.organizations.createOrganization({
      name,
      createdBy: userId, // becomes the organization's first admin
      publicMetadata: state.domain ? { domain: state.domain } : {},
    })
    // Work out the organization's brand colors after responding, so set-up
    // isn't held up; the new scheme shows on the next page load.
    const domain = state.domain
    if (domain) {
      after(async () => {
        try {
          const theme = await generateBrandTheme(domain)
          if (theme) await saveOrgTheme(organization.id, theme)
        } catch (error) {
          console.error('Brand colors failed for', domain, error)
        }
      })
    }
    return { error: null, organizationId: organization.id }
  } catch (error) {
    console.error('setupOrganization failed', error)
    return { error: 'The organization could not be created. Try again.', organizationId: null }
  }
}
