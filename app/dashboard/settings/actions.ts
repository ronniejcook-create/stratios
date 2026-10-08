'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { generateBrandTheme, saveOrgTheme } from '@/lib/brandColors'
import { THEME_ROLES, ensureReadable, normalizeHex, type OrgTheme } from '@/lib/theme'

async function requireAdmin() {
  const { orgId, orgRole } = await auth()
  if (!orgId || orgRole !== 'org:admin') redirect('/dashboard/settings?status=not-admin')
  return orgId
}

function done(status: string): never {
  revalidatePath('/dashboard', 'layout')
  redirect(`/dashboard/settings?status=${status}`)
}

export async function saveColours(formData: FormData): Promise<void> {
  const orgId = await requireAdmin()
  const theme = {} as OrgTheme
  for (const { key } of THEME_ROLES) {
    const hex = normalizeHex(formData.get(key))
    if (!hex) done('invalid')
    theme[key] = hex
  }
  const readable = ensureReadable(theme)
  const adjusted = THEME_ROLES.some(({ key }) => readable[key] !== theme[key])
  try {
    await saveOrgTheme(orgId, readable)
  } catch (error) {
    console.error('saveColours failed', error)
    done('failed')
  }
  done(adjusted ? 'saved-adjusted' : 'saved')
}

export async function regenerateColours(): Promise<void> {
  const orgId = await requireAdmin()
  let status = 'regenerated'
  try {
    const client = await clerkClient()
    const organization = await client.organizations.getOrganization({ organizationId: orgId })
    const domain = typeof organization.publicMetadata?.domain === 'string' ? organization.publicMetadata.domain : null
    if (!domain) {
      status = 'no-domain'
    } else {
      const theme = await generateBrandTheme(domain)
      if (theme) await saveOrgTheme(orgId, theme)
      else status = process.env.ANTHROPIC_API_KEY ? 'generate-failed' : 'no-key'
    }
  } catch (error) {
    console.error('regenerateColours failed', error)
    status = 'failed'
  }
  done(status)
}

export async function resetColours(): Promise<void> {
  const orgId = await requireAdmin()
  try {
    await saveOrgTheme(orgId, null)
  } catch (error) {
    console.error('resetColours failed', error)
    done('failed')
  }
  done('reset')
}
