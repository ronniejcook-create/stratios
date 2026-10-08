'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { generateBrandTheme, saveChartColors, saveGeneratedBrand, saveOrgTheme } from '@/lib/brandColors'
import { CHART_SLOTS } from '@/lib/chartColors'
import { GRAPH_PRESETS } from '@/lib/presets'
import { getOrgSettings } from '@/lib/orgSettings'
import { THEME_ROLES, ensureReadable, normalizeHex, type BrandColors, type OrgTheme } from '@/lib/theme'

// Nothing on the Org Colors page is saved until Save is clicked: presets,
// Dark/Light and hand edits are previewed in the browser, and these actions
// store the result.

async function requireAdmin() {
  const { orgId, orgRole } = await auth()
  if (!orgId || orgRole !== 'org:admin') redirect('/dashboard/settings?status=not-admin')
  return orgId
}

function done(status: string, detail?: string): never {
  revalidatePath('/dashboard', 'layout')
  const query = new URLSearchParams({ status, ...(detail ? { detail: detail.slice(0, 400) } : {}) })
  redirect(`/dashboard/settings?${query.toString()}`)
}

/** Accepts colors typed with or without the leading "#". */
function withHash(value: FormDataEntryValue | null): string {
  const text = String(value ?? '').trim()
  return text.startsWith('#') ? text : `#${text}`
}

export async function saveColors(formData: FormData): Promise<void> {
  const orgId = await requireAdmin()
  const theme = {} as OrgTheme
  for (const { key } of THEME_ROLES) {
    const hex = normalizeHex(withHash(formData.get(key)))
    if (!hex) done('invalid')
    theme[key] = hex
  }
  const mode = formData.get('mode') === 'light' ? 'light' : 'dark'
  const primary = normalizeHex(formData.get('brandPrimary'))
  const accent = normalizeHex(formData.get('brandAccent'))
  const brand: BrandColors | null = primary && accent ? { primary, accent } : null

  const readable = ensureReadable(theme)
  const adjusted = THEME_ROLES.some(({ key }) => readable[key] !== theme[key])
  try {
    await saveOrgTheme(orgId, readable, { brand, mode })
  } catch (error) {
    console.error('saveColors failed', error)
    done('failed')
  }
  done(adjusted ? 'saved-adjusted' : 'saved')
}

/**
 * Returns the brand colors Stratios generated for the organization, for the
 * page to preview. They are kept from set-up, so this normally costs nothing;
 * an organization that never had colors generated gets one lookup, whose
 * result is kept. The organization's colors are not changed here.
 */
export async function getGeneratedBrand(): Promise<{ brand: BrandColors; note?: string } | { error: string }> {
  const { orgId, orgRole } = await auth()
  if (!orgId || orgRole !== 'org:admin') return { error: 'Only administrators can change the colors.' }
  try {
    const client = await clerkClient()
    const [organization, settings] = await Promise.all([client.organizations.getOrganization({ organizationId: orgId }), getOrgSettings(orgId)])
    const kept = settings.generatedBrand as { primary?: unknown; accent?: unknown } | null
    const primary = normalizeHex(kept?.primary)
    const accent = normalizeHex(kept?.accent)
    if (primary && accent) return { brand: { primary, accent } }

    const result = await generateBrandTheme({ name: organization.name, domain: settings.domain })
    if (!result.theme) return { error: result.error }
    await saveGeneratedBrand(orgId, result.brand)
    return { brand: result.brand, note: result.note }
  } catch (error) {
    console.error('getGeneratedBrand failed', error)
    return { error: 'Brand colors could not be worked out. Try again.' }
  }
}

export async function saveGraphColors(formData: FormData): Promise<void> {
  const orgId = await requireAdmin()
  const source = String(formData.get('source') ?? 'manual')
  let value: { colors: string[]; source: 'preset' | 'manual'; name?: string } | null = null
  if (source !== 'generated') {
    const colors: string[] = []
    for (let slot = 1; slot <= CHART_SLOTS; slot++) {
      const hex = normalizeHex(withHash(formData.get(`chart-${slot}`)))
      if (!hex) done('graph-invalid')
      colors.push(hex)
    }
    const preset = GRAPH_PRESETS.find((p) => p.name === formData.get('presetName'))
    const unchangedPreset = source === 'preset' && preset !== undefined && preset.colors.every((c, i) => c === colors[i])
    value = unchangedPreset ? { colors, source: 'preset', name: preset.name } : { colors, source: 'manual' }
  }
  try {
    // null = back to the colors generated from the site colors.
    await saveChartColors(orgId, value)
  } catch (error) {
    console.error('saveGraphColors failed', error)
    done('failed')
  }
  done('graph-saved')
}
