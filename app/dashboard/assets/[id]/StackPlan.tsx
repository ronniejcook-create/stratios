'use client'

import { useState } from 'react'
import { RENT_ROLL_STATUS_LABELS, type RentRollRow } from '@/lib/rentRolls'

type ColorBy = 'expiration' | 'status'

const whole = (value: number) => Math.round(value).toLocaleString('en-US')
function day(value: string | null): string {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/**
 * How a suite is shaded. Leases are grouped by the year they end, counted
 * from the year of the rent roll: the sooner a lease ends, the darker the
 * block, so the floors that need attention stand out. Every block also says
 * what it is in words, so the picture never depends on color alone.
 */
function groupOf(row: RentRollRow, colorBy: ColorBy, baseYear: number): { key: string; label: string } {
  if (row.status === 'vacant') return { key: 'vacant', label: 'Vacant' }
  if (row.status === 'other') return { key: 'other', label: 'Not for Lease' }
  if (colorBy === 'status') return { key: 'leased', label: 'Leased' }
  if (!row.leaseEnd) return { key: 'nodate', label: 'Leased, No End Date' }
  const year = Number(row.leaseEnd.slice(0, 4))
  const ahead = Math.max(0, Math.min(4, year - baseYear))
  const label = ahead === 0 ? `Ends ${baseYear} or Earlier` : ahead === 4 ? `Ends ${baseYear + 4} or Later` : `Ends ${baseYear + ahead}`
  return { key: `y${ahead}`, label }
}
const GROUP_ORDER = ['y0', 'y1', 'y2', 'y3', 'y4', 'leased', 'nodate', 'vacant', 'other']

/**
 * A stack plan: the building drawn floor by floor, top floor first. Each
 * suite is a block as wide as its share of the largest floor, so floors and
 * suites can be compared by eye. Drawn from one rent roll snapshot.
 */
export function StackPlan({ rows, asOfDate, caption }: { rows: RentRollRow[]; asOfDate: string; caption: string }) {
  const [colorBy, setColorBy] = useState<ColorBy>('expiration')
  const [open, setOpen] = useState<string | null>(null)
  const baseYear = Number(asOfDate.slice(0, 4)) || new Date().getFullYear()

  const placed = rows.filter((row) => row.floor !== null && row.floor !== undefined)
  const unplaced = rows.filter((row) => row.floor === null || row.floor === undefined)
  const floors = [...new Set(placed.map((row) => row.floor as number))].sort((a, b) => b - a)
  const sfOf = (list: RentRollRow[]) => list.reduce((sum, row) => sum + (row.squareFeet ?? 0), 0)
  const levels = [
    ...floors.map((floor) => ({ key: String(floor), name: floor < 0 ? `Basement ${-floor}` : `Floor ${floor}`, rows: placed.filter((row) => row.floor === floor) })),
    ...(unplaced.length > 0 ? [{ key: 'none', name: 'No Floor', rows: unplaced }] : []),
  ]
  const widest = Math.max(1, ...levels.map((level) => sfOf(level.rows)))
  const used = GROUP_ORDER.filter((key) => rows.some((row) => groupOf(row, colorBy, baseYear).key === key))
  const anyInferred = placed.some((row) => row.floorInferred)
  const selected = rows.find((row) => row.id === open) ?? null

  if (rows.length === 0) return <p className="empty">This rent roll has no rows to draw.</p>
  if (placed.length === 0) {
    return (
      <p className="empty">
        None of this rent roll&apos;s rows has a floor, so there is nothing to stack. Floors are worked out when a rent roll is read, by the Reading a Rent Roll skill; a rent roll loaded before that needs to be loaded again.
      </p>
    )
  }

  return (
    <div className="stack-plan">
      <div className="stack-head">
        <p className="rent-roll-date">{caption}</p>
        <div className="field stack-color">
          <label htmlFor="stack-color">Color By</label>
          <select id="stack-color" value={colorBy} onChange={(event) => setColorBy(event.target.value as ColorBy)}>
            <option value="expiration">Lease End Year</option>
            <option value="status">Status</option>
          </select>
        </div>
      </div>
      <ul className="stack-key" aria-label="Color key">
        {used.map((key) => (
          <li key={key}>
            <span className={`stack-swatch stack-${key}`} aria-hidden="true" />
            {groupOf(rows.find((row) => groupOf(row, colorBy, baseYear).key === key)!, colorBy, baseYear).label}
          </li>
        ))}
      </ul>

      <div className="stack-floors">
        {levels.map((level) => {
          const total = sfOf(level.rows)
          const leased = sfOf(level.rows.filter((row) => row.status === 'leased'))
          return (
            <div key={level.key} className="stack-floor">
              <div className="stack-floor-name">
                <strong>{level.name}</strong>
                <span>{whole(total)} SF{total > 0 ? ` · ${Math.round((leased / total) * 100)}% leased` : ''}</span>
              </div>
              <div className="stack-row" style={{ width: `${Math.max(12, (total / widest) * 100)}%` }}>
                {level.rows.map((row) => {
                  const group = groupOf(row, colorBy, baseYear)
                  const title = [
                    row.suite ? `Suite ${row.suite}` : null,
                    row.tenant,
                    row.squareFeet !== null ? `${whole(row.squareFeet)} SF` : null,
                    row.status === 'leased' && row.leaseEnd ? `lease ends ${day(row.leaseEnd)}` : RENT_ROLL_STATUS_LABELS[row.status],
                  ].filter(Boolean).join(' · ')
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className={`stack-suite stack-${group.key}${open === row.id ? ' active' : ''}`}
                      style={{ flexGrow: Math.max(1, row.squareFeet ?? 1), flexBasis: 0 }}
                      title={title}
                      aria-label={title}
                      aria-pressed={open === row.id}
                      onClick={() => setOpen(open === row.id ? null : row.id)}
                    >
                      <span className="stack-suite-name">{row.suite ?? ''}</span>
                      <span className="stack-suite-tenant">{row.status === 'leased' ? row.tenant ?? '' : RENT_ROLL_STATUS_LABELS[row.status]}</span>
                      <span className="stack-suite-sf">{row.squareFeet !== null ? whole(row.squareFeet) : ''}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {selected ? (
        <dl className="stack-detail" role="status">
          <div><dt>Suite</dt><dd>{selected.suite ?? 'Not shown'}</dd></div>
          <div><dt>Tenant</dt><dd>{selected.tenant ?? 'Not shown'}</dd></div>
          <div><dt>Status</dt><dd>{RENT_ROLL_STATUS_LABELS[selected.status]}</dd></div>
          <div><dt>Floor</dt><dd>{selected.floor ?? 'Not known'}{selected.floor !== null && selected.floor !== undefined && selected.floorInferred ? ' (worked out from the suite number)' : ''}</dd></div>
          <div><dt>Square Feet</dt><dd>{selected.squareFeet !== null ? whole(selected.squareFeet) : 'Not shown'}</dd></div>
          <div><dt>Lease</dt><dd>{selected.leaseStart || selected.leaseEnd ? `${day(selected.leaseStart) || '?'} to ${day(selected.leaseEnd) || '?'}` : 'Not shown'}</dd></div>
          <div><dt>Annual Rent</dt><dd>{selected.annualRent !== null ? selected.annualRent.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : 'Not shown'}</dd></div>
        </dl>
      ) : (
        <p className="doc-sub">Click a suite for its details. Each block is as wide as the suite&apos;s share of the largest floor.</p>
      )}
      {anyInferred ? <p className="doc-sub">Some floors were worked out from suite numbers because the rent roll does not show them. The rule is in the Reading a Rent Roll skill.</p> : null}
      {unplaced.length > 0 ? <p className="doc-sub">{unplaced.length === 1 ? '1 row has' : `${unplaced.length} rows have`} no floor and {unplaced.length === 1 ? 'is' : 'are'} shown under No Floor.</p> : null}
    </div>
  )
}
