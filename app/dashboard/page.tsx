import { auth } from '@clerk/nextjs/server'
import { ASSET_TYPES, listAssets, type Asset } from '@/lib/assets'
import { isDatabaseConfigured } from '@/lib/db'
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
          <p>Set DATABASE_URL and run the migration in db/migrations to start adding assets. See the README.</p>
        </div>
      </>
    )
  }

  let assets: Asset[] = []
  let loadFailed = false
  try {
    assets = await listAssets(orgId)
  } catch (error) {
    console.error('listAssets failed', error)
    loadFailed = true
  }

  return (
    <>
      <h1>Assets</h1>
      <p className="lede">Everyone in your organization sees this list.</p>

      <section className="panel">
        <h2>Add an Asset</h2>
        <AddAssetForm assetTypes={ASSET_TYPES} />
      </section>

      <section className="panel">
        <h2>Your Organization&apos;s Assets</h2>
        {loadFailed ? (
          <p className="form-error" role="alert">The assets could not be loaded. Check the database connection and that the migration has been run.</p>
        ) : assets.length === 0 ? (
          <p className="empty">No assets yet. Add the first one above.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">City</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id}>
                    <td>{asset.name}</td>
                    <td>{asset.asset_type}</td>
                    <td>{asset.city ?? ''}</td>
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
