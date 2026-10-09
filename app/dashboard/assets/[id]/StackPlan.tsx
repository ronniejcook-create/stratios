'use client'

import { useEffect, useRef, useState } from 'react'
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
 * from the year of the rent roll, and each group takes one of the
 * organization's graph colors (Org Colors > Graph Colors), in order: the
 * first color for leases ending soonest. Every block also says what it is in
 * words, and the key names each color, so the picture never depends on color
 * alone.
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
/** Which graph color (--chart-1 to --chart-8) each group is filled with. Vacant and not-for-lease space is drawn without one. */
const GROUP_SLOT: Record<string, number> = { y0: 1, y1: 2, y2: 3, y3: 4, y4: 5, leased: 3, nodate: 6 }

/** Dark or light lettering, whichever reads better on a fill. */
function letteringFor(color: string): string | undefined {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color.trim())?.[1]
  if (!hex) return undefined
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // Contrast against near-black versus white; take the better.
  return (luminance + 0.05) / 0.06 >= 1.05 / (luminance + 0.05) ? '#06182f' : '#ffffff'
}

/** Suites in order: 100, 102, 110 ... then lettered ones, the way a floor is walked. */
const bySuite = (a: RentRollRow, b: RentRollRow) =>
  a.suite === null ? (b.suite === null ? a.position - b.position : 1) : b.suite === null ? -1 : a.suite.localeCompare(b.suite, undefined, { numeric: true, sensitivity: 'base' }) || a.position - b.position

/**
 * A stack plan: the building drawn floor by floor, top floor first. Every
 * floor is the same width, with its suites in suite-number order, each as
 * wide as its share of that floor. Drawn from one rent roll snapshot.
 */
export function StackPlan({ rows, asOfDate }: { rows: RentRollRow[]; asOfDate: string }) {
  const [colorBy, setColorBy] = useState<ColorBy>('expiration')
  const [open, setOpen] = useState<string | null>(null)
  // The fills are the organization's graph colors, which the page carries as --chart-1 ... --chart-8.
  // Once they can be read, each fill gets dark or light lettering to suit it.
  const root = useRef<HTMLDivElement>(null)
  const [lettering, setLettering] = useState<Record<number, string | undefined>>({})
  useEffect(() => {
    if (!root.current) return
    const style = getComputedStyle(root.current)
    setLettering(Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((slot) => [slot, letteringFor(style.getPropertyValue(`--chart-${slot}`))])))
  }, [])
  const baseYear = Number(asOfDate.slice(0, 4)) || new Date().getFullYear()

  const placed = rows.filter((row) => row.floor !== null && row.floor !== undefined)
  const unplaced = rows.filter((row) => row.floor === null || row.floor === undefined)
  const floors = [...new Set(placed.map((row) => row.floor as number))].sort((a, b) => b - a)
  const sfOf = (list: RentRollRow[]) => list.reduce((sum, row) => sum + (row.squareFeet ?? 0), 0)
  const levels = [
    ...floors.map((floor) => ({ key: String(floor), name: floor < 0 ? `Basement ${-floor}` : `Floor ${floor}`, rows: placed.filter((row) => row.floor === floor).sort(bySuite) })),
    ...(unplaced.length > 0 ? [{ key: 'none', name: 'No Floor', rows: [...unplaced].sort(bySuite) }] : []),
  ]
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
    <div className="stack-plan" ref={root}>
      <div className="stack-head">
        <h3>Stack Plan</h3>
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
              <div className="stack-row">
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
                      style={{ flexGrow: Math.max(1, row.squareFeet ?? 1), flexBasis: 0, color: lettering[GROUP_SLOT[group.key]] }}
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
        <p className="doc-sub">Click a suite for its details. Suites run left to right in suite-number order, each as wide as its share of its floor. The colors are your organization&apos;s graph colors.</p>
      )}
      {anyInferred ? <p className="doc-sub">Some floors were worked out from suite numbers because the rent roll does not show them. The rule is in the Reading a Rent Roll skill.</p> : null}
      {unplaced.length > 0 ? <p className="doc-sub">{unplaced.length === 1 ? '1 row has' : `${unplaced.length} rows have`} no floor and {unplaced.length === 1 ? 'is' : 'are'} shown under No Floor.</p> : null}
    </div>
  )
}
