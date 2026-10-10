import { auth } from '@clerk/nextjs/server'
import { DEFAULT_PROPERTY_TYPES, listPropertyTypes } from '@/lib/assets'
import { isDatabaseConfigured, isMissingSchema, withOrg } from '@/lib/db'
import { loadAccess } from '@/lib/permissions'
import { listMainPhotos } from '@/lib/photos'
import { listAssetLocations, type AssetLocations } from '@/lib/locationFacts'
import { listAssets, type AssetSummary } from '@/lib/records'
import type { GridRow } from '@/components/DataGrid'
import { AssetsGrid } from './AssetsGrid'

export const dynamic = 'force-dynamic'

export default async function AssetsPage() {
  const { orgId, userId, orgRole } = await auth()
  if (!orgId || !userId) return null // the layout redirects before this renders

  if (!isDatabaseConfigured()) {
    return (
      <>
        <h1>Assets</h1>
        <div className="panel notice">
          <h2>Database Not Connected</h2>
          <p>Set DATABASE_URL and run the migrations in db/migrations to start adding assets. See the README.</p>
        </div>
      </>
    )
  }

  let assets: AssetSummary[] = []
  let problem: 'none' | 'update-needed' | 'failed' = 'none'
  let canAdd = orgRole === 'org:admin'
  let propertyTypes: readonly string[] = DEFAULT_PROPERTY_TYPES
  try {
    assets = await withOrg(orgId, (client) => listAssets(client, orgId))
    // What Add Asset offers: the organization's own Property Type list.
    propertyTypes = await withOrg(orgId, (client) => listPropertyTypes(client, orgId))
  } catch (error) {
    console.error('listAssets failed', error)
    problem = isMissingSchema(error) ? 'update-needed' : 'failed'
  }

  // Kept separate so the list still shows if the roles tables aren't there yet.
  if (!canAdd && problem === 'none') {
    try {
      canAdd = (await withOrg(orgId, (client) => loadAccess(client, orgId, userId, false))).canAddRecords
    } catch (error) {
      console.error('loadAccess failed', error)
    }
  }

  if (problem === 'update-needed') {
    return (
      <>
        <h1>Assets</h1>
        <div className="panel notice">
          <h2>Database Update Needed</h2>
          <p>
            Stratios now stores properties, buildings and dynamic fields. Run db/migrations/003_fields.sql against the
            database, then reload this page. Existing assets are kept.
          </p>
        </div>
      </>
    )
  }

  // Main photos are loaded on their own, so the list still shows if the photos table isn't there yet.
  let mainPhotos = new Map<string, string>()
  if (problem === 'none' && assets.length > 0) {
    try {
      mainPhotos = await withOrg(orgId, (client) => listMainPhotos(client, orgId))
    } catch (error) {
      if (!isMissingSchema(error)) console.error('listMainPhotos failed', error)
    }
  }

  // The Location columns (flood zone, school district) are loaded on their own too, and only those the person may see.
  let locations: AssetLocations = { columns: [], byAsset: new Map() }
  if (problem === 'none' && assets.length > 0) {
    try {
      locations = await withOrg(orgId, (client) => listAssetLocations(client, orgId, userId, orgRole === 'org:admin'))
    } catch (error) {
      if (!isMissingSchema(error)) console.error('listAssetLocations failed', error)
    }
  }
  const locationOf = (assetId: string, key: string) => locations.byAsset.get(assetId)?.[key] ?? []

  const rows: GridRow[] = assets.map((asset) => ({
    id: asset.id,
    href: `/dashboard/assets/${asset.id}`,
    image: mainPhotos.has(asset.id) ? `/api/photos/${mainPhotos.get(asset.id)}` : undefined,
    cells: {
      name: asset.name,
      properties: String(asset.propertyCount),
      type: asset.propertyTypes.join(', '),
      city: asset.cities.join(', '),
      ...Object.fromEntries(locations.columns.map((column) => [column.key, locationOf(asset.id, column.key).join(', ')])),
    },
    order: { properties: asset.propertyCount },
    // An asset with several properties can have several types and cities; each can be ticked on its own.
    values: { type: asset.propertyTypes, city: asset.cities, ...Object.fromEntries(locations.columns.map((column) => [column.key, locationOf(asset.id, column.key)])) },
  }))

  return (
    <>
      <h1>Assets</h1>
      <p className="lede">Everyone in your organization sees this list.</p>

      <section className="panel">
        <h2>Your Organization&apos;s Assets</h2>
        {problem === 'failed' ? (
          <p className="form-error" role="alert">The assets could not be loaded. Check the database connection and that the migrations have been run.</p>
        ) : (
          <AssetsGrid rows={rows} canAdd={canAdd} propertyTypes={propertyTypes} extraColumns={locations.columns} />
        )}
      </section>
    </>
  )
}
