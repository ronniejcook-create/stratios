import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { DataGrid, type GridColumn, type GridRow } from '@/components/DataGrid'
import { isDatabaseConfigured, withOrg } from '@/lib/db'
import { loadAccess } from '@/lib/permissions'
import { isUuid } from '@/lib/records'
import { getTenant, listLeases, tenantsReady } from '@/lib/tenants'

export const dynamic = 'force-dynamic'

const whole = (value: number) => Math.round(value).toLocaleString('en-US')
const money = (value: number | null, cents = false) =>
  value === null ? '' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })
function day(value: string | null): string {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const stamp = (value: string | null) => (value ? Date.parse(`${value}T00:00:00Z`) : Number.MAX_SAFE_INTEGER)

const COLUMNS: GridColumn[] = [
  { key: 'asset', label: 'Asset', display: 'link' },
  { key: 'property', label: 'Property' },
  { key: 'unit', label: 'Unit' },
  { key: 'status', label: 'Status', display: 'chip' },
  { key: 'sf', label: 'Square Feet', numeric: true },
  { key: 'start', label: 'Lease Start', numeric: true },
  { key: 'end', label: 'Lease End', numeric: true },
  { key: 'rentPsf', label: 'Rent per SF', numeric: true },
  { key: 'annual', label: 'Annual Rent', numeric: true },
  { key: 'recovery', label: 'Recovery' },
]

/** One tenant: its other names and every lease it holds or held, across the organization's assets. */
export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId, orgRole } = await auth()
  if (!orgId || !userId) return null // the layout redirects before this renders
  const { id } = await params
  if (!isDatabaseConfigured() || !isUuid(id)) notFound()

  const loaded = await withOrg(orgId, async (client) => {
    const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
    if (!access.canAddRecords || !(await tenantsReady(client))) return null
    const tenant = await getTenant(client, orgId, id)
    return tenant ? { tenant, leases: await listLeases(client, orgId, { tenantId: id }) } : null
  })
  if (!loaded) notFound()
  const { tenant, leases } = loaded!

  const active = leases.filter((lease) => lease.status === 'active')
  const tiles = [
    { label: 'Active Leases', value: whole(active.length) },
    { label: 'Leased Square Feet', value: whole(active.reduce((sum, lease) => sum + (lease.squareFeet ?? 0), 0)) },
    { label: 'Annual Base Rent', value: money(active.reduce((sum, lease) => sum + (lease.annualRent ?? 0), 0)) },
    { label: 'Next Lease End', value: day(active.map((lease) => lease.endDate).filter((end): end is string => end !== null).sort()[0] ?? null) || 'None' },
  ]
  const rows: GridRow[] = leases.map((lease) => ({
    id: lease.id,
    href: `/dashboard/assets/${lease.assetId}?screen=_leases`,
    cells: {
      asset: lease.assetName,
      property: lease.propertyName,
      unit: lease.unitName ?? '',
      status: lease.status === 'active' ? 'Active' : 'Past',
      sf: lease.squareFeet === null ? '' : whole(lease.squareFeet),
      start: day(lease.startDate),
      end: day(lease.endDate),
      rentPsf: money(lease.rentPerSf, true),
      annual: money(lease.annualRent),
      recovery: lease.recoveryType ?? '',
    },
    order: { sf: lease.squareFeet ?? -1, start: stamp(lease.startDate), end: stamp(lease.endDate), rentPsf: lease.rentPerSf ?? -1, annual: lease.annualRent ?? -1 },
    tones: { status: lease.status === 'active' ? 'plain' : 'muted' },
  }))

  return (
    <>
      <p className="crumbs">
        <Link href="/dashboard/tenants">Tenants</Link>
        <span aria-hidden="true"> / </span>
        <span>{tenant.name}</span>
      </p>
      <h1>{tenant.name}</h1>
      <p className="lede">
        Tenant
        <span className="record-key" title="The permanent key used by agents">{`tenant:${tenant.key}`}</span>
      </p>

      <section className="panel">
        <h2>Leases</h2>
        {tenant.aliases.length > 0 ? (
          <p className="note">
            Also written as:
            <span className="tenant-names">
              {tenant.aliases.map((alias) => (
                <span key={alias} className="chip">{alias}</span>
              ))}
            </span>
          </p>
        ) : null}
        <div className="field-list tiles rent-roll-tiles">
          {tiles.map((tile) => (
            <div key={tile.label} className="field-card rent-roll-tile">
              <span className="field-card-label">{tile.label}</span>
              <span className="field-card-value">{tile.value}</span>
            </div>
          ))}
        </div>
        <p className="doc-sub">Added up from the active leases. A lease is active while its property&apos;s latest rent roll shows it.</p>
        <DataGrid columns={COLUMNS} rows={rows} noun="leases" searchColumns={['asset', 'property', 'unit']} searchPlaceholder="Search by asset, property or unit" emptyText="This tenant has no leases in the rent rolls loaded now." />
      </section>
    </>
  )
}
