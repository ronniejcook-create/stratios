'use client'

import { useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DataGrid, type GridColumn, type GridRow } from '@/components/DataGrid'
import { rollover, tenantShares, type Lease, type TenantQuestion } from '@/lib/tenants'
import { rebuildLeases } from '../../tenants/actions'
import { TenantQuestions } from '../../tenants/TenantQuestions'

const whole = (value: number) => Math.round(value).toLocaleString('en-US')
const money = (value: number | null, cents = false) =>
  value === null ? '' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })
/** "2029-06-30" -> "Jun 30, 2029", read as a plain calendar date. */
function day(value: string | null): string {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const stamp = (value: string | null) => (value ? Date.parse(`${value}T00:00:00Z`) : Number.MAX_SAFE_INTEGER)
const percent = (value: number | null) => (value === null ? '' : `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`)

const TOP_TENANTS = 10

/**
 * The Leases tab of an asset: the tenants and leases built from its rent
 * rolls. A lease is active while the property's latest rent roll shows it.
 * Everything here is worked out from the rent rolls; nothing is typed in.
 */
export function LeasesPanel({
  assetId,
  leases,
  questions,
  rentRolls,
  latestDate,
  severalProperties,
  kpis,
}: {
  assetId: string
  leases: Lease[]
  questions: TenantQuestion[]
  /** How many rent rolls the asset has. */
  rentRolls: number
  /** The date of the latest rent roll, which decides which leases are active. */
  latestDate: string | null
  severalProperties: boolean
  /** The KPIs calculated from these leases, shown above them. */
  kpis?: ReactNode
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  const rebuild = () => {
    setMessage(null)
    start(async () => {
      const result = await rebuildLeases({ assetId })
      setMessage(result.ok ? { text: result.message, error: false } : { text: result.error, error: true })
      if (result.ok) router.refresh()
    })
  }
  // Leases are built by themselves whenever a rent roll is loaded, deleted or re-dated. This button is only offered when
  // an asset has rent rolls and no leases, which means that step did not finish (or the rent rolls are older than leases).
  const build = (
    <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={rebuild}>
      {busy ? 'Building…' : 'Build Leases From Rent Rolls'}
    </button>
  )
  const notice = message ? <p className={message.error ? 'form-error' : 'form-ok'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null

  if (rentRolls === 0) {
    return (
      <section className="panel">
        <h2>Leases</h2>
        <p className="note">Tenants and leases are built from rent rolls. Load a rent roll for this asset, in the Documents tab or by dropping it on the agent, and they will appear here.</p>
      </section>
    )
  }

  const active = leases.filter((lease) => lease.status === 'active')
  const past = leases.length - active.length
  const years = rollover(leases)
  const tenants = tenantShares(leases)
  const leasedSf = active.reduce((sum, lease) => sum + (lease.squareFeet ?? 0), 0)
  const annualRent = active.reduce((sum, lease) => sum + (lease.annualRent ?? 0), 0)
  const tiles = [
    { label: 'Active Leases', value: whole(active.length) },
    { label: 'Tenants', value: whole(tenants.length) },
    { label: 'Leased Square Feet', value: whole(leasedSf) },
    { label: 'Annual Base Rent', value: money(annualRent) },
  ]

  const columns: GridColumn[] = [
    { key: 'tenant', label: 'Tenant', display: 'link' as const },
    { key: 'unit', label: 'Unit' },
    ...(severalProperties ? [{ key: 'property', label: 'Property' }] : []),
    { key: 'status', label: 'Status', display: 'chip' as const },
    { key: 'sf', label: 'Square Feet', numeric: true },
    { key: 'start', label: 'Lease Start', numeric: true },
    { key: 'end', label: 'Lease End', numeric: true },
    { key: 'rentPsf', label: 'Rent per SF', numeric: true },
    { key: 'annual', label: 'Annual Rent', numeric: true },
    { key: 'recovery', label: 'Recovery' },
    { key: 'seen', label: 'Last Rent Roll', numeric: true },
  ]
  const rows: GridRow[] = leases.map((lease) => ({
    id: lease.id,
    href: `/dashboard/leases/${lease.id}`,
    cells: {
      tenant: lease.tenantName,
      unit: lease.unitName ?? '',
      property: lease.propertyName,
      status: lease.status === 'active' ? 'Active' : 'Past',
      sf: lease.squareFeet === null ? '' : whole(lease.squareFeet),
      start: day(lease.startDate),
      end: day(lease.endDate),
      rentPsf: money(lease.rentPerSf, true),
      annual: money(lease.annualRent),
      recovery: lease.recoveryType ?? '',
      seen: day(lease.lastSeen),
    },
    order: {
      sf: lease.squareFeet ?? -1,
      start: stamp(lease.startDate),
      end: stamp(lease.endDate),
      rentPsf: lease.rentPerSf ?? -1,
      annual: lease.annualRent ?? -1,
      seen: stamp(lease.lastSeen),
    },
    tones: { status: lease.status === 'active' ? 'plain' : 'muted' },
  }))

  return (
    <>
      <TenantQuestions questions={questions} assetId={assetId} />
      {kpis}
      <section className="panel">
        <h2>Leases</h2>
        <p className="note">
          Built from this asset&apos;s rent rolls, and brought up to date whenever a rent roll is loaded, deleted or given a new date. A lease is active while the latest rent roll{latestDate ? ` (${day(latestDate)})` : ''} shows it, and past once it no longer does. Click a tenant to open its lease, where the lease agreement is loaded and its terms are kept. Which
          rows count as tenants, which names are asked about and what makes a row the same lease are set by the Reading a Rent Roll skill in the Skills Library.
        </p>
        {notice}

        {leases.length === 0 ? (
          <>
            <p className="note" role="status">
              {questions.length > 0 ? 'No leases yet: every tenant name is waiting to be confirmed above.' : 'No leases have been built from the rent rolls yet.'}
            </p>
            {questions.length === 0 ? <div className="button-row">{build}</div> : null}
          </>
        ) : (
          <>
            <div className="field-list tiles rent-roll-tiles">
              {tiles.map((tile) => (
                <div key={tile.label} className="field-card rent-roll-tile">
                  <span className="field-card-label">{tile.label}</span>
                  <span className="field-card-value">{tile.value}</span>
                </div>
              ))}
            </div>
            <p className="doc-sub">Added up from the active leases{past > 0 ? `; ${past === 1 ? '1 past lease is' : `${whole(past)} past leases are`} listed below but not counted` : ''}.</p>

            <div className="lease-summaries">
              <div>
                <h3>Lease Expirations</h3>
                <div className="table-scroll">
                  <table className="lease-table">
                    <thead>
                      <tr><th scope="col">Year</th><th scope="col" className="num">Leases</th><th scope="col" className="num">Square Feet</th><th scope="col" className="num">Share of Leased</th><th scope="col" className="num">Annual Rent</th></tr>
                    </thead>
                    <tbody>
                      {years.map((year) => (
                        <tr key={year.year}>
                          <th scope="row">{year.year}</th>
                          <td className="num">{whole(year.leases)}</td>
                          <td className="num">{whole(year.squareFeet)}</td>
                          <td className="num">{percent(year.share)}</td>
                          <td className="num">{money(year.annualRent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h3>Largest Tenants</h3>
                <div className="table-scroll">
                  <table className="lease-table">
                    <thead>
                      <tr><th scope="col">Tenant</th><th scope="col" className="num">Square Feet</th><th scope="col" className="num">Share of Leased</th><th scope="col" className="num">Annual Rent</th><th scope="col" className="num">Next Lease End</th></tr>
                    </thead>
                    <tbody>
                      {tenants.slice(0, TOP_TENANTS).map((tenant) => (
                        <tr key={tenant.tenantId}>
                          <th scope="row"><Link href={`/dashboard/tenants/${tenant.tenantId}`}>{tenant.tenantName}</Link></th>
                          <td className="num">{whole(tenant.squareFeet)}</td>
                          <td className="num">{percent(tenant.share)}</td>
                          <td className="num">{money(tenant.annualRent)}</td>
                          <td className="num">{day(tenant.nextEnd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {tenants.length > TOP_TENANTS ? <p className="doc-sub">The {TOP_TENANTS} largest of {whole(tenants.length)} tenants, by square feet.</p> : null}
              </div>
            </div>

            <DataGrid columns={columns} rows={rows} noun="leases" searchColumns={['tenant', 'unit']} searchPlaceholder="Search tenants and units" emptyText="No leases." exportName="Leases" />
          </>
        )}
      </section>
    </>
  )
}
