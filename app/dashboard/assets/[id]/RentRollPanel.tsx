'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DataGrid, type GridColumn, type GridRow, type GridTone } from '@/components/DataGrid'
import { RENT_ROLL_STATUS_LABELS, summarize, type RentRollRow, type RentRollStatus } from '@/lib/rentRolls'
import { changeRentRollDate, removeRentRoll } from './actions'

export type RentRollChoice = {
  id: string
  asOfDate: string
  /** False when the document gave no date and the day it was loaded was used. */
  asOfStated: boolean
  propertyName: string
  documentId: string | null
  documentName: string | null
  rowCount: number
  stated: { totalSf: number | null; leasedSf: number | null; vacantSf: number | null }
}

const whole = (value: number) => Math.round(value).toLocaleString('en-US')
const money = (value: number | null, cents = false) =>
  value === null ? '' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })
/** "2029-06-30" -> "Jun 30, 2029", read as a plain calendar date. */
function day(value: string | null, monthOnly = false): string {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', monthOnly ? { month: 'short', year: 'numeric', timeZone: 'UTC' } : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const stamp = (value: string | null) => (value ? Date.parse(`${value}T00:00:00Z`) : Number.MAX_SAFE_INTEGER)

const COLUMNS: GridColumn[] = [
  { key: 'suite', label: 'Suite' },
  { key: 'tenant', label: 'Tenant' },
  { key: 'status', label: 'Status', display: 'chip' },
  { key: 'sf', label: 'Square Feet', numeric: true },
  { key: 'start', label: 'Lease Start', numeric: true },
  { key: 'end', label: 'Lease End', numeric: true },
  { key: 'rentPsf', label: 'Rent per SF', numeric: true },
  { key: 'annual', label: 'Annual Rent', numeric: true },
  { key: 'monthly', label: 'Monthly Rent', numeric: true },
  { key: 'steps', label: 'Rent Steps' },
  { key: 'recovery', label: 'Recovery' },
  { key: 'note', label: 'Note' },
]
const TONES: Record<RentRollStatus, GridTone> = { leased: 'plain', vacant: 'modified', other: 'muted' }

/**
 * The Rent Roll tab of an asset: one dated snapshot at a time, chosen from
 * the snapshots that have been loaded, with its totals and its rows in the
 * same sortable, filterable grid as the other lists.
 */
export function RentRollPanel({
  assetId,
  choices,
  selectedId,
  rows,
  canEdit,
  severalProperties,
}: {
  assetId: string
  choices: RentRollChoice[]
  selectedId: string | null
  rows: RentRollRow[]
  canEdit: boolean
  severalProperties: boolean
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [mode, setMode] = useState<'view' | 'date' | 'remove'>('view')
  const [date, setDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const selected = choices.find((choice) => choice.id === selectedId) ?? null

  if (!selected) {
    return (
      <section className="panel">
        <h2>Rent Roll</h2>
        <p className="empty">
          No rent roll has been loaded for this asset yet.
          {canEdit ? ' Drop a rent roll (PDF or Excel) on the agent column and ask the analyst to load it, or upload it on the Documents tab. Each one is kept as its own dated snapshot.' : ''}
        </p>
      </section>
    )
  }

  const label = (choice: RentRollChoice) =>
    `As of ${day(choice.asOfDate)}${severalProperties ? ` · ${choice.propertyName}` : ''} · ${choice.rowCount} ${choice.rowCount === 1 ? 'row' : 'rows'}`
  const open = (id: string) => router.push(`/dashboard/assets/${assetId}?screen=_rentroll&rentRoll=${id}`)
  const act = (work: () => Promise<{ ok: true } | { ok: false; error: string }>, after: () => void) => {
    setError(null)
    start(async () => {
      const result = await work()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setMode('view')
      after()
    })
  }

  const sums = summarize(rows)
  const tiles: { label: string; value: string }[] = [
    { label: 'Total Square Feet', value: whole(sums.totalSf) },
    { label: 'Leased Square Feet', value: `${whole(sums.leasedSf)}${sums.leasedPercent !== null ? ` (${sums.leasedPercent}%)` : ''}` },
    { label: 'Vacant Square Feet', value: whole(sums.vacantSf) },
    ...(sums.otherSf > 0 ? [{ label: 'Not for Lease', value: whole(sums.otherSf) }] : []),
    { label: 'Tenants', value: String(sums.tenants) },
    { label: 'Annual Base Rent', value: money(sums.annualRent) },
  ]
  // The document's own totals, where it shows them, are a check on the rows.
  const checks = [
    { name: 'total', shown: selected.stated.totalSf, added: sums.totalSf },
    { name: 'leased', shown: selected.stated.leasedSf, added: sums.leasedSf },
    { name: 'vacant', shown: selected.stated.vacantSf, added: sums.vacantSf },
  ].filter((check) => check.shown !== null && Math.abs(check.shown - check.added) >= 1)

  const gridRows: GridRow[] = rows.map((row) => ({
    id: row.id,
    cells: {
      suite: row.suite ?? '',
      tenant: row.tenant ?? '',
      status: RENT_ROLL_STATUS_LABELS[row.status],
      sf: row.squareFeet === null ? '' : whole(row.squareFeet),
      start: day(row.leaseStart),
      end: day(row.leaseEnd),
      rentPsf: money(row.rentPerSf, true),
      annual: money(row.annualRent),
      monthly: money(row.monthlyRent),
      steps: row.steps.map((step) => [day(step.date, true), step.rentPerSf !== null ? `${money(step.rentPerSf, true)}/SF` : money(step.annualRent)].filter(Boolean).join(': ')).filter(Boolean).join('; '),
      recovery: row.recoveryType ?? '',
      note: row.note ?? '',
    },
    order: {
      sf: row.squareFeet ?? -1,
      start: stamp(row.leaseStart),
      end: stamp(row.leaseEnd),
      rentPsf: row.rentPerSf ?? -1,
      annual: row.annualRent ?? -1,
      monthly: row.monthlyRent ?? -1,
    },
    tones: { status: TONES[row.status] },
  }))

  return (
    <section className="panel">
      <h2>Rent Roll</h2>
      <div className="rent-roll-head">
        {choices.length > 1 ? (
          <div className="field">
            <label htmlFor="rent-roll-choice">Snapshot</label>
            <select id="rent-roll-choice" value={selected.id} onChange={(event) => open(event.target.value)}>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>{label(choice)}</option>
              ))}
            </select>
          </div>
        ) : (
          <p className="rent-roll-date">{label(selected)}</p>
        )}
        {canEdit && mode === 'view' ? (
          <span className="rent-roll-actions">
            <button type="button" className="link-button" onClick={() => { setDate(selected.asOfDate); setError(null); setMode('date') }}>Change Date</button>
            <button type="button" className="link-button danger" onClick={() => { setError(null); setMode('remove') }}>Remove Rent Roll</button>
          </span>
        ) : null}
      </div>

      {mode === 'date' ? (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault()
            act(() => changeRentRollDate({ rentRollId: selected.id, date }), () => router.refresh())
          }}
        >
          <div className="field field-narrow">
            <label htmlFor="rent-roll-date">As of Date</label>
            <input id="rent-roll-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required autoFocus />
          </div>
          <div className="field-edit-buttons">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy || !date}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setMode('view')}>Cancel</button>
          </div>
        </form>
      ) : null}
      {mode === 'remove' ? (
        <p className="review-actions">
          <span className="note">This removes this snapshot and its {selected.rowCount} rows. The document it came from, and any values filled in from it, stay.</span>
          <button type="button" className="btn btn-ghost btn-small danger" disabled={busy} onClick={() => act(() => removeRentRoll({ rentRollId: selected.id }), () => router.push(`/dashboard/assets/${assetId}?screen=_rentroll`))}>Confirm Remove</button>
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setMode('view')}>Cancel</button>
        </p>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <p className="note">
        {selected.documentName ? (
          <>
            From{' '}
            {selected.documentId ? <a href={`/dashboard/assets/${assetId}/documents/${selected.documentId}`}>{selected.documentName}</a> : <>{selected.documentName} (the document has since been removed)</>}.{' '}
          </>
        ) : null}
        {selected.asOfStated ? null : 'The document gave no date, so the day it was loaded is shown. '}
        {!selected.asOfStated && canEdit ? 'Use Change Date to set the right one. ' : null}
        The rows are copied as the document shows them.
      </p>

      <div className="field-list tiles rent-roll-tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="field-card rent-roll-tile">
            <span className="field-card-label">{tile.label}</span>
            <span className="field-card-value">{tile.value}</span>
          </div>
        ))}
      </div>
      <p className="doc-sub">These totals are added up from the rows below.</p>
      {checks.map((check) => (
        <p key={check.name} className="form-error" role="status">
          The document shows {whole(check.shown!)} {check.name} square feet, but the rows add up to {whole(check.added)}. Check the rows against the document.
        </p>
      ))}

      <DataGrid
        columns={COLUMNS}
        rows={gridRows}
        noun="rows"
        searchColumns={['suite', 'tenant']}
        searchPlaceholder="Search suites and tenants"
        emptyText="This rent roll has no rows."
      />
    </section>
  )
}
