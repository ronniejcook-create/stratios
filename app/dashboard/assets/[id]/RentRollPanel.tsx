'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DataGrid, Modal, type GridColumn, type GridRow, type GridTone } from '@/components/DataGrid'
import { RENT_ROLL_STATUS_LABELS, summarize, type RentRollRow, type RentRollStatus } from '@/lib/rentRolls'
import { changeRentRollDate, removeRentRoll } from './actions'
import { StackPlan } from './StackPlan'

export type RentRollChoice = {
  id: string
  asOfDate: string
  /** False when the document gave no date and the day it was loaded was used. */
  asOfStated: boolean
  propertyName: string
  /** The type of the property the rent roll is for; an office property gets a stack plan under the totals. */
  propertyType: string | null
  /** The property's type is Office, or one that counts as Office; the stack plan is drawn for those. */
  office: boolean
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
  { key: 'suite', label: 'Unit' },
  { key: 'floor', label: 'Floor', numeric: true },
  { key: 'tenant', label: 'Tenant', display: 'link' },
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
  const [withDocument, setWithDocument] = useState(true)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selected = choices.find((choice) => choice.id === selectedId) ?? null

  if (!selected) {
    return (
      <section className="panel">
        <h2>Rent Roll</h2>
        {done ? <p className="form-ok" role="status">{done}</p> : null}
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
  // The document's own totals are shown wherever it gives them, so the figures here match the page; the rows fill in the rest.
  const { stated } = selected
  const totalSf = stated.totalSf ?? sums.totalSf
  const leasedSf = stated.leasedSf ?? sums.leasedSf
  const vacantSf = stated.vacantSf ?? sums.vacantSf
  const otherSf = stated.totalSf !== null && stated.leasedSf !== null && stated.vacantSf !== null ? Math.max(0, stated.totalSf - stated.leasedSf - stated.vacantSf) : sums.otherSf
  const leasedPercent = totalSf > 0 ? Math.round((leasedSf / totalSf) * 1000) / 10 : null
  const anyStated = stated.totalSf !== null || stated.leasedSf !== null || stated.vacantSf !== null
  const tiles: { label: string; value: string }[] = [
    { label: 'Total Square Feet', value: whole(totalSf) },
    { label: 'Leased Square Feet', value: `${whole(leasedSf)}${leasedPercent !== null ? ` (${leasedPercent.toFixed(1)}%)` : ''}` },
    { label: 'Vacant Square Feet', value: whole(vacantSf) },
    ...(otherSf > 0 ? [{ label: 'Not for Lease', value: whole(otherSf) }] : []),
    { label: 'Tenants', value: String(sums.tenants) },
    { label: 'Annual Base Rent', value: money(sums.annualRent) },
  ]
  // Where the rows don't add up to the document's total, say so quietly: the tile keeps the document's figure.
  const checks = [
    { name: 'total', shown: stated.totalSf, added: sums.totalSf },
    { name: 'leased', shown: stated.leasedSf, added: sums.leasedSf },
    { name: 'vacant', shown: stated.vacantSf, added: sums.vacantSf },
  ].filter((check) => check.shown !== null && Math.abs(check.shown - check.added) >= 1)

  const gridRows: GridRow[] = rows.map((row) => ({
    id: row.id,
    // A row with a lease on file opens that lease from its tenant's name.
    href: row.leaseId ? `/dashboard/leases/${row.leaseId}` : undefined,
    cells: {
      suite: row.suite ?? '',
      floor: row.floor === null || row.floor === undefined ? '' : String(row.floor),
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
      floor: row.floor ?? -1000,
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
            <button type="button" className="btn btn-ghost btn-small" onClick={() => { setDate(selected.asOfDate); setError(null); setMode('date') }}>Change Date</button>
            <button type="button" className="btn btn-ghost btn-small danger" onClick={() => { setError(null); setWithDocument(true); setMode('remove') }}>Delete Rent Roll</button>
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
      <Modal open={mode === 'remove'} title="Delete This Rent Roll?" onClose={() => { if (!busy) setMode('view') }}>
        <p className="modal-text">
          The rent roll <strong>as of {day(selected.asOfDate)}</strong> and its {selected.rowCount} {selected.rowCount === 1 ? 'row' : 'rows'} will be permanently deleted. Other rent rolls on this asset are not touched, and values already filled in from the document stay.
        </p>
        {selected.documentId ? (
          <label className="modal-check">
            <input type="checkbox" checked={withDocument} onChange={(event) => setWithDocument(event.target.checked)} />
            <span>Also delete the document it came from ({selected.documentName}), so the same file can be loaded again from scratch.</span>
          </label>
        ) : null}
        <p className="modal-text modal-warning">This cannot be undone. Are you sure?</p>
        {mode === 'remove' && error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="button-row modal-actions">
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setMode('view')}>Cancel</button>
          <button
            type="button"
            className="btn btn-small btn-danger"
            disabled={busy}
            onClick={() => {
              setError(null)
              start(async () => {
                const result = await removeRentRoll({ rentRollId: selected.id, withDocument: withDocument && selected.documentId !== null })
                if (!result.ok) {
                  setError(result.error)
                  return
                }
                setMode('view')
                setDone(result.message)
                // Back to the tab without the deleted snapshot in the address, then load what is left.
                router.replace(`/dashboard/assets/${assetId}?screen=_rentroll`)
                router.refresh()
              })
            }}
          >
            {busy ? 'Deleting…' : 'Yes, Delete Rent Roll'}
          </button>
        </div>
      </Modal>
      {mode !== 'remove' && error ? <p className="form-error" role="alert">{error}</p> : null}
      {done ? <p className="form-ok" role="status">{done}</p> : null}

      <p className="note">
        {selected.documentName ? (
          <>
            From{' '}
            {selected.documentId ? <a href={`/dashboard/assets/${assetId}/documents/${selected.documentId}`}>{selected.documentName}</a> : <>{selected.documentName} (the document has since been removed)</>}.{' '}
          </>
        ) : null}
        {selected.asOfStated ? null : 'The document gave no date, so the day it was loaded is shown. '}
        {!selected.asOfStated && canEdit ? 'Use Change Date to set the right one. ' : null}
        The rows are copied as the document shows them. A tenant&apos;s name opens its lease.
      </p>

      <div className="field-list tiles rent-roll-tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="field-card rent-roll-tile">
            <span className="field-card-label">{tile.label}</span>
            <span className="field-card-value">{tile.value}</span>
          </div>
        ))}
      </div>
      <p className="doc-sub">
        {anyStated ? 'Square feet are the document\'s own totals. Tenants and rent are added up from the rows below.' : 'These totals are added up from the rows below.'}
      </p>
      {checks.map((check) => (
        <p key={check.name} className="note" role="status">
          The document&apos;s {check.name === 'total' ? 'total' : `${check.name} total`} of {whole(check.shown!)} square feet is shown. {check.name === 'total' ? 'The rows' : 'The rows marked that way'} add up to {whole(check.added)}, so one or more rows are marked differently from how the document counts them. How rows are marked is set by the Reading a Rent Roll skill in the Skills Library.
        </p>
      ))}

      {selected.office ? <StackPlan key={selected.id} rows={rows} asOfDate={selected.asOfDate} /> : null}

      <DataGrid
        columns={COLUMNS}
        rows={gridRows}
        noun="rows"
        searchColumns={['suite', 'tenant']}
        searchPlaceholder="Search units and tenants"
        defaultSort={{ column: 'suite', descending: false }}
        emptyText="This rent roll has no rows."
      />
    </section>
  )
}
