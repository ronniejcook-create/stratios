import { auth } from '@clerk/nextjs/server'
import { DataGrid, type GridColumn, type GridRow } from '@/components/DataGrid'
import { isDatabaseConfigured, withOrg } from '@/lib/db'
import { loadAccess } from '@/lib/permissions'
import { listTenantQuestions, listTenants, tenantsReady, type TenantQuestion, type TenantSummary } from '@/lib/tenants'
import { TenantQuestions } from './TenantQuestions'

export const dynamic = 'force-dynamic'
// Confirming a name rebuilds the leases of every rent roll that was waiting on it.
export const maxDuration = 60

const whole = (value: number) => Math.round(value).toLocaleString('en-US')
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
function day(value: string | null): string {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const stamp = (value: string | null) => (value ? Date.parse(`${value}T00:00:00Z`) : Number.MAX_SAFE_INTEGER)

const COLUMNS: GridColumn[] = [
  { key: 'name', label: 'Tenant', display: 'link' },
  { key: 'properties', label: 'Properties' },
  { key: 'leases', label: 'Active Leases', numeric: true },
  { key: 'sf', label: 'Square Feet', numeric: true },
  { key: 'rent', label: 'Annual Rent', numeric: true },
  { key: 'nextEnd', label: 'Next Lease End', numeric: true },
  { key: 'otherNames', label: 'Other Names' },
]

/** Every tenant of the organization, across all its assets, built from the rent rolls. */
export default async function TenantsPage() {
  const { orgId, userId, orgRole } = await auth()
  if (!orgId || !userId) return null // the layout redirects before this renders

  let tenants: TenantSummary[] = []
  let questions: TenantQuestion[] = []
  let state: 'ok' | 'no-access' | 'update' | 'failed' = isDatabaseConfigured() ? 'ok' : 'failed'
  if (state === 'ok') {
    try {
      const found = await withOrg(orgId, async (client) => {
        // Rents and tenants are shown to the people who can see a rent roll: administrators and roles that can edit.
        const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
        if (!access.canAddRecords) return 'no-access' as const
        if (!(await tenantsReady(client))) return 'update' as const
        return { tenants: await listTenants(client, orgId), questions: await listTenantQuestions(client, orgId) }
      })
      if (typeof found === 'string') state = found
      else {
        tenants = found.tenants
        questions = found.questions
      }
    } catch (error) {
      console.error('TenantsPage failed', error)
      state = 'failed'
    }
  }

  if (state !== 'ok') {
    return (
      <>
        <h1>Tenants</h1>
        <div className="panel notice">
          <h2>{state === 'no-access' ? 'Not Available for Your Role' : state === 'update' ? 'Database Update Needed' : 'The Tenants Could Not Be Loaded'}</h2>
          <p>
            {state === 'no-access'
              ? 'Tenants and their rents are shown to administrators and to roles that can edit. Ask an administrator if you need them.'
              : state === 'update'
                ? 'Run db/migrations/024_tenants_and_leases.sql against the database, then reload this page.'
                : 'Check the database connection and try again.'}
          </p>
        </div>
      </>
    )
  }

  const rows: GridRow[] = tenants.map((tenant) => ({
    id: tenant.id,
    href: `/dashboard/tenants/${tenant.id}`,
    cells: {
      name: tenant.name,
      properties: tenant.properties.join(', '),
      leases: String(tenant.leases),
      sf: tenant.leases > 0 ? whole(tenant.squareFeet) : '',
      rent: tenant.leases > 0 ? money(tenant.annualRent) : '',
      nextEnd: day(tenant.nextEnd),
      otherNames: tenant.aliases.join(', '),
    },
    order: { leases: tenant.leases, sf: tenant.squareFeet, rent: tenant.annualRent, nextEnd: stamp(tenant.nextEnd) },
    values: { properties: tenant.properties, otherNames: tenant.aliases },
  }))

  return (
    <>
      <h1>Tenants</h1>
      <p className="lede">Every tenant across your assets, built from the rent rolls you load. Totals count each tenant&apos;s active leases.</p>
      <TenantQuestions questions={questions} />
      <section className="panel">
        <h2>Your Organization&apos;s Tenants</h2>
        <DataGrid
          columns={COLUMNS}
          rows={rows}
          noun="tenants"
          searchColumns={['name', 'otherNames', 'properties']}
          searchPlaceholder="Search by tenant or property"
          emptyText="No tenants yet. They are added when a rent roll is loaded for an asset."
        />
      </section>
    </>
  )
}
