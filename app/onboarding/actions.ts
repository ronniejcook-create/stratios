'use server'

import { auth, clerkClient } from '@clerk/nextjs/server'
import { generateBrandTheme, saveGeneratedBrand, saveOrgTheme } from '@/lib/brandColors'
import { getOnboardingState } from '@/lib/organizations'
import { isDomainTaken, updateOrgSettings } from '@/lib/orgSettings'

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
    })
    if (state.domain) {
      try {
        await updateOrgSettings(organization.id, { domain: state.domain })
      } catch (error) {
        // Undo the organization if its domain could not be recorded (for example,
        // a colleague set up the same company at the same moment).
        await client.organizations.deleteOrganization(organization.id).catch(() => {})
        if (isDomainTaken(error)) {
          return { error: 'Your company was just set up by a colleague. Refresh the page to ask them for an invitation.', organizationId: null }
        }
        throw error
      }
    }
    // Pick and save the organization's dark-mode brand colors before opening
    // the app (by name first, its website second), so the very first page is
    // already in its colors. If this fails, it starts with the Stratios colors.
    // Graph colors aren't looked up: they are generated from the site colors.
    try {
      const result = await generateBrandTheme({ name, domain: state.domain }, 'dark')
      if (result.theme) {
        await saveOrgTheme(organization.id, result.theme, { brand: result.brand, mode: 'dark' })
        await saveGeneratedBrand(organization.id, result.brand)
      }
      if (!result.theme) console.warn('Brand colors not set for', name, '-', result.error)
    } catch (error) {
      console.error('Brand colors failed for', name, error)
    }
    return { error: null, organizationId: organization.id }
  } catch (error) {
    console.error('setupOrganization failed', error)
    return { error: 'The organization could not be created. Try again.', organizationId: null }
  }
}
