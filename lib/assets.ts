import { withOrg } from './db'

export const ASSET_TYPES = ['Office', 'Retail', 'Industrial', 'Multifamily', 'Mixed use', 'Other'] as const

export type Asset = {
  id: string
  name: string
  asset_type: string
  city: string | null
  created_at: Date
}

// Queries filter by org_id explicitly as well as relying on row-level
// security, so a misconfigured database role cannot expose other tenants.

export function listAssets(orgId: string): Promise<Asset[]> {
  return withOrg(orgId, async (client) => {
    const { rows } = await client.query<Asset>(
      'select id, name, asset_type, city, created_at from assets where org_id = $1 order by created_at desc',
      [orgId],
    )
    return rows
  })
}

export function createAsset(
  orgId: string,
  userId: string,
  input: { name: string; assetType: string; city: string | null },
): Promise<void> {
  return withOrg(orgId, async (client) => {
    await client.query(
      'insert into assets (org_id, name, asset_type, city, created_by) values ($1, $2, $3, $4, $5)',
      [orgId, input.name, input.assetType, input.city, userId],
    )
  })
}
