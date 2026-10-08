'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { generateBrandTheme, saveOrgTheme } from '@/lib/brandColors'
import { DEFAULT_BRAND, THEME_ROLES, deriveTheme, ensureReadable, normalizeHex, parseBrandSettings, parseTheme, type OrgTheme } from '@/lib/theme'

async function requireAdmin() {
  const { orgId, orgRole } = await auth()
  if (!orgId || orgRole !== 'org:admin') redirect('/dashboard/settings?status=not-admin')
  return orgId
}

async function loadOrganization(orgId: string) {
  const client = await clerkClient()
  const organization = await client.organizations.getOrganization({ organizationId: orgId })
  const domain = typeof organization.publicMetadata?.domain === 'string' ? organization.publicMetadata.domain : null
  return { name: organization.name, domain, stored: parseTheme(organization.publicMetadata?.theme), ...parseBrandSettings(organization.publicMetadata?.theme) }
}

function saturation(hex: string): number {
  const values = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(...values)
  const min = Math.min(...values)
  return max === 0 ? 0 : (max - min) / max
}

function done(status: string, detail?: string): never {
  revalidatePath('/dashboard', 'layout')
  const query = new URLSearchParams({ status, ...(detail ? { detail: detail.slice(0, 400) } : {}) })
  redirect(`/dashboard/settings?${query.toString()}`)
}

export async function saveColors(formData: FormData): Promise<void> {
  const orgId = await requireAdmin()
  const theme = {} as OrgTheme
  for (const { key } of THEME_ROLES) {
    const hex = normalizeHex(withHash(formData.get(key)))
    if (!hex) done('invalid')
    theme[key] = hex
  }
  const readable = ensureReadable(theme)
  const adjusted = THEME_ROLES.some(({ key }) => readable[key] !== theme[key])
  try {
    const { brand, mode } = await loadOrganization(orgId)
    await saveOrgTheme(orgId, readable, { brand, mode })
  } catch (error) {
    console.error('saveColors failed', error)
    done('failed')
  }
  done(adjusted ? 'saved-adjusted' : 'saved')
}

export async function setMode(formData: FormData): Promise<void> {
  const orgId = await requireAdmin()
  const mode = formData.get('mode') === 'light' ? 'light' : 'dark'
  try {
    // Rebuild all ten colors for the chosen mode from the brand colors.
    const { brand, stored } = await loadOrganization(orgId)
    // Schemes saved before brand colors were recorded: use their accent and the
    // most strongly colored of their backgrounds as the brand colors.
    const inferred = stored
      ? { primary: [stored.backgroundDeep, stored.heading].sort((a, b) => saturation(b) - saturation(a))[0], accent: stored.accent }
      : null
    const source = brand ?? inferred ?? DEFAULT_BRAND
    await saveOrgTheme(orgId, deriveTheme(source.primary, source.accent, mode), { brand, mode })
  } catch (error) {
    console.error('setMode failed', error)
    done('failed')
  }
  done(`mode-${mode}`)
}

/** Accepts colors typed with or without the leading "#". */
function withHash(value: FormDataEntryValue | null): string {
  const text = String(value ?? '').trim()
  return text.startsWith('#') ? text : `#${text}`
}

export async function regenerateColors(): Promise<void> {
  const orgId = await requireAdmin()
  let status = 'regenerated'
  let detail: string | undefined
  try {
    const { name, domain, mode } = await loadOrganization(orgId)
    const result = await generateBrandTheme({ name, domain }, mode)
    if (result.theme) {
      await saveOrgTheme(orgId, result.theme, { brand: result.brand, mode })
      detail = result.note
    } else {
      status = process.env.ANTHROPIC_API_KEY ? 'generate-failed' : 'no-key'
      detail = result.error
    }
  } catch (error) {
    console.error('regenerateColors failed', error)
    status = 'failed'
  }
  done(status, detail)
}

export async function resetColors(): Promise<void> {
  const orgId = await requireAdmin()
  try {
    await saveOrgTheme(orgId, null)
  } catch (error) {
    console.error('resetColors failed', error)
    done('failed')
  }
  done('reset')
}
