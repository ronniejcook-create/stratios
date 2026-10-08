import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { PROPERTY_TYPES } from '@/lib/assets'
import { isDatabaseConfigured, isMissingSchema, withOrg } from '@/lib/db'
import { listAssets, type AssetSummary } from '@/lib/records'
import { AddAssetForm } from './AddAssetForm'

export const dynamic = 'force-dynamic'

export default async function AssetsPage() {
  const { orgId } = await auth()
  if (!orgId) return null // the layout redirects before this renders

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
  try {
    assets = await withOrg(orgId, (client) => listAssets(client, orgId))
  } catch (error) {
    console.error('listAssets failed', error)
    problem = isMissingSchema(error) ? 'update-needed' : 'failed'
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

  return (
    <>
      <h1>Assets</h1>
      <p className="lede">Everyone in your organization sees this list.</p>

      <section className="panel">
        <h2>Add an Asset</h2>
        <AddAssetForm propertyTypes={PROPERTY_TYPES} />
      </section>

      <section className="panel">
        <h2>Your Organization&apos;s Assets</h2>
        {problem === 'failed' ? (
          <p className="form-error" role="alert">The assets could not be loaded. Check the database connection and that the migrations have been run.</p>
        ) : assets.length === 0 ? (
          <p className="empty">No assets yet. Add the first one above.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Properties</th>
                  <th scope="col">Type</th>
                  <th scope="col">City</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id}>
                    <td><Link href={`/dashboard/assets/${asset.id}`}>{asset.name}</Link></td>
                    <td>{asset.propertyCount}</td>
                    <td>{asset.propertyTypes.join(', ')}</td>
                    <td>{asset.cities.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
