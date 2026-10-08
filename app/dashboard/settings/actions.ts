'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { generateBrandTheme, lookUpChartColors, saveChartColors, saveOrgTheme } from '@/lib/brandColors'
import { CHART_SLOTS } from '@/lib/chartColors'
import { GRAPH_PRESETS, SITE_PRESETS } from '@/lib/presets'
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

export async function saveGraphColors(formData: FormData): Promise<void> {
  const orgId = await requireAdmin()
  const colors: string[] = []
  for (let slot = 1; slot <= CHART_SLOTS; slot++) {
    const hex = normalizeHex(withHash(formData.get(`chart-${slot}`)))
    if (!hex) done('graph-invalid')
    colors.push(hex)
  }
  try {
    await saveChartColors(orgId, { colors, source: 'manual' })
  } catch (error) {
    console.error('saveGraphColors failed', error)
    done('failed')
  }
  done('graph-saved')
}

export async function lookUpGraphColors(): Promise<void> {
  const orgId = await requireAdmin()
  let status = 'graph-found'
  let detail: string | undefined
  try {
    const { name, domain } = await loadOrganization(orgId)
    const result = await lookUpChartColors({ name, domain })
    if (result.colors) {
      await saveChartColors(orgId, { colors: result.colors, source: 'history' })
    } else if (result.error) {
      status = 'generate-failed'
      detail = result.error
    } else {
      // Nothing known: fall back to graph colors built from the brand colors.
      await saveChartColors(orgId, null)
      status = 'graph-not-found'
    }
  } catch (error) {
    console.error('lookUpGraphColors failed', error)
    status = 'failed'
  }
  done(status, detail)
}

export async function resetGraphColors(): Promise<void> {
  const orgId = await requireAdmin()
  try {
    await saveChartColors(orgId, null)
  } catch (error) {
    console.error('resetGraphColors failed', error)
    done('failed')
  }
  done('graph-reset')
}

export async function applySitePreset(formData: FormData): Promise<void> {
  const orgId = await requireAdmin()
  const preset = SITE_PRESETS.find((p) => p.name === formData.get('preset'))
  if (!preset) done('failed')
  try {
    // The preset's two colors become the organization's brand colors.
    const { mode } = await loadOrganization(orgId)
    const brand = { primary: preset.primary, accent: preset.accent }
    await saveOrgTheme(orgId, deriveTheme(brand.primary, brand.accent, mode), { brand, mode })
  } catch (error) {
    console.error('applySitePreset failed', error)
    done('failed')
  }
  done('site-preset')
}

export async function applyGraphPreset(formData: FormData): Promise<void> {
  const orgId = await requireAdmin()
  const preset = GRAPH_PRESETS.find((p) => p.name === formData.get('preset'))
  if (!preset) done('failed')
  try {
    await saveChartColors(orgId, { colors: preset.colors, source: 'preset', name: preset.name })
  } catch (error) {
    console.error('applyGraphPreset failed', error)
    done('failed')
  }
  done('graph-preset')
}
