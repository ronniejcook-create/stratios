import { clerkClient } from '@clerk/nextjs/server'
import { isDatabaseConfigured, query } from './db'

/**
 * Per-organization settings: company domain and color schemes.
 *
 * Stored in the database (table organization_settings) when DATABASE_URL is
 * set; otherwise in the organization's Clerk metadata, where earlier versions
 * of Stratios kept them. Settings still in Clerk are copied into the database
 * the first time an organization is read, so existing organizations move over
 * on their own.
 */
export type OrgSettings = {
  domain: string | null
  theme: unknown
  generatedBrand: unknown
  chartColors: unknown
}

type SettingKey = keyof OrgSettings

const COLUMNS: Record<SettingKey, string> = {
  domain: 'domain',
  theme: 'theme',
  generatedBrand: 'generated_brand',
  chartColors: 'chart_colors',
}

type Row = { domain: string | null; theme: unknown; generated_brand: unknown; chart_colors: unknown }

async function readFromClerk(orgId: string): Promise<OrgSettings> {
  const client = await clerkClient()
  const organization = await client.organizations.getOrganization({ organizationId: orgId })
  const meta = (organization.publicMetadata ?? {}) as Record<string, unknown>
  return {
    domain: typeof meta.domain === 'string' ? meta.domain : null,
    theme: meta.theme ?? null,
    generatedBrand: meta.generatedBrand ?? null,
    chartColors: meta.chartColors ?? null,
  }
}

export async function getOrgSettings(orgId: string): Promise<OrgSettings> {
  if (!isDatabaseConfigured()) return readFromClerk(orgId)

  const rows = await query<Row>(
    'select domain, theme, generated_brand, chart_colors from organization_settings where org_id = $1',
    [orgId],
  )
  if (rows[0]) {
    const row = rows[0]
    return { domain: row.domain, theme: row.theme, generatedBrand: row.generated_brand, chartColors: row.chart_colors }
  }

  // First time this organization is read with a database: copy over anything
  // an earlier version kept in Clerk.
  const legacy = await readFromClerk(orgId)
  if (legacy.domain || legacy.theme || legacy.generatedBrand || legacy.chartColors) {
    try {
      await updateOrgSettings(orgId, legacy)
    } catch (error) {
      console.error('Copying settings from Clerk failed for', orgId, error)
    }
  }
  return legacy
}

/** Saves the given settings (others are left as they are). null clears a setting. */
export async function updateOrgSettings(orgId: string, patch: Partial<OrgSettings>): Promise<void> {
  const keys = (Object.keys(patch) as SettingKey[]).filter((key) => patch[key] !== undefined)
  if (keys.length === 0) return

  if (!isDatabaseConfigured()) {
    const client = await clerkClient()
    await client.organizations.updateOrganizationMetadata(orgId, {
      publicMetadata: Object.fromEntries(keys.map((key) => [key, patch[key] ?? null])),
    })
    return
  }

  const values = keys.map((key) => (key === 'domain' ? (patch.domain ?? null) : patch[key] == null ? null : JSON.stringify(patch[key])))
  const columns = keys.map((key) => COLUMNS[key])
  const placeholders = keys.map((key, i) => (key === 'domain' ? `$${i + 2}` : `$${i + 2}::jsonb`))
  await query(
    `insert into organization_settings (org_id, ${columns.join(', ')})
     values ($1, ${placeholders.join(', ')})
     on conflict (org_id) do update set ${columns.map((c) => `${c} = excluded.${c}`).join(', ')}, updated_at = now()`,
    [orgId, ...values],
  )
}

/** True if a database error means the domain is already claimed by another organization. */
export function isDomainTaken(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
}

/** The organization that registered a company email domain, if any. */
export async function findOrgIdByDomain(domain: string): Promise<string | null> {
  if (isDatabaseConfigured()) {
    const rows = await query<{ org_id: string }>('select org_id from organization_settings where domain = $1', [domain])
    if (rows[0]) return rows[0].org_id
  }
  // Not in the database (or no database): look through organizations whose
  // settings are still kept in Clerk.
  const client = await clerkClient()
  const pageSize = 100
  for (let offset = 0; ; offset += pageSize) {
    const page = await client.organizations.getOrganizationList({ limit: pageSize, offset })
    const match = page.data.find((org) => org.publicMetadata?.domain === domain)
    if (match) {
      if (isDatabaseConfigured()) await getOrgSettings(match.id) // copies it into the database
      return match.id
    }
    if (page.data.length < pageSize) return null
  }
}
