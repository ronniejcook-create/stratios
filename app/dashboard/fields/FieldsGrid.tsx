'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AddFieldForm, type FormAction, type LevelOption, type PlaceOption } from './Forms'

/** One field, flattened to what the grid shows. Built on the server by each Fields Library page. */
export type FieldRow = {
  id: string
  href: string
  name: string
  fieldKey: string
  /** Asset, Property, Building and so on. */
  belongsTo: string
  type: string
  shownIn: string
  /** The last column: a status, or how many organizations customized the field. */
  status: string
  statusTone: 'plain' | 'own' | 'modified' | 'muted'
  /** Used when sorting the last column, so "2 organizations" sorts as a number. */
  statusOrder: number
}

type ColumnKey = 'name' | 'fieldKey' | 'belongsTo' | 'type' | 'shownIn' | 'status'
type Sort = { column: ColumnKey; descending: boolean } | null

const TONE_CLASS: Record<FieldRow['statusTone'], string> = { plain: 'chip', own: 'chip chip-own', modified: 'chip chip-modified', muted: 'muted' }

const distinct = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b))

/**
 * The Fields Library grid: one row per field with a search box, a filter per
 * column, sorting by clicking a column heading, and Add Field in a pop-up.
 * `rows` arrive in the standard order (level, then where shown), which is the
 * order used until a heading is clicked.
 */
export function FieldsGrid({
  rows,
  statusHeading,
  belongsToOrder,
  addTitle,
  addAction,
  levels,
  types,
  places,
}: {
  rows: FieldRow[]
  statusHeading: string
  /** The levels in their natural order (Asset first), for the filter and for sorting that column. */
  belongsToOrder: string[]
  addTitle: string
  addAction?: FormAction
  levels: LevelOption[]
  types: LevelOption[]
  places: PlaceOption[]
}) {
  const [search, setSearch] = useState('')
  const [belongsTo, setBelongsTo] = useState('')
  const [type, setType] = useState('')
  const [shownIn, setShownIn] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<Sort>(null)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (adding && !element.open) element.showModal()
    if (!adding && element.open) element.close()
  }, [adding])

  const levelOptions = belongsToOrder.filter((level) => rows.some((row) => row.belongsTo === level))
  const typeOptions = useMemo(() => distinct(rows.map((row) => row.type)), [rows])
  const shownInOptions = useMemo(() => distinct(rows.map((row) => row.shownIn)), [rows])
  const statusOptions = useMemo(() => distinct(rows.map((row) => row.status)), [rows])

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase()
    const kept = rows.filter(
      (row) =>
        (!term || row.name.toLowerCase().includes(term) || row.fieldKey.toLowerCase().includes(term)) &&
        (!belongsTo || row.belongsTo === belongsTo) &&
        (!type || row.type === type) &&
        (!shownIn || row.shownIn === shownIn) &&
        (!status || row.status === status),
    )
    if (!sort) return kept
    const compare = (a: FieldRow, b: FieldRow) => {
      if (sort.column === 'belongsTo') return belongsToOrder.indexOf(a.belongsTo) - belongsToOrder.indexOf(b.belongsTo)
      if (sort.column === 'status') return a.statusOrder - b.statusOrder || a.status.localeCompare(b.status)
      return a[sort.column].localeCompare(b[sort.column], undefined, { sensitivity: 'base' })
    }
    // Ties keep the standard order, so a sorted column still reads sensibly.
    return kept
      .map((row, index) => ({ row, index }))
      .sort((a, b) => (sort.descending ? -1 : 1) * compare(a.row, b.row) || a.index - b.index)
      .map((entry) => entry.row)
  }, [rows, search, belongsTo, type, shownIn, status, sort, belongsToOrder])

  const filtered = Boolean(search.trim() || belongsTo || type || shownIn || status)
  const clear = () => {
    setSearch('')
    setBelongsTo('')
    setType('')
    setShownIn('')
    setStatus('')
  }

  // First click sorts A to Z, the second Z to A, the third goes back to the standard order.
  const sortBy = (column: ColumnKey) =>
    setSort((current) => (current?.column !== column ? { column, descending: false } : current.descending ? null : { column, descending: true }))

  const heading = (column: ColumnKey, label: string) => {
    const active = sort?.column === column
    return (
      <th scope="col" aria-sort={active ? (sort?.descending ? 'descending' : 'ascending') : 'none'}>
        <button type="button" className={`sort-button${active ? ' active' : ''}`} onClick={() => sortBy(column)} title={`Sort by ${label}`}>
          {label}
          <span className="sort-arrow" aria-hidden="true">{active ? (sort?.descending ? '▼' : '▲') : '↕'}</span>
        </button>
      </th>
    )
  }

  const select = (label: string, value: string, change: (next: string) => void, options: string[]) => (
    <select aria-label={`Filter by ${label}`} value={value} onChange={(event) => change(event.target.value)}>
      <option value="">{label}: All</option>
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  )

  return (
    <>
      <div className="grid-toolbar">
        <input
          type="search"
          className="grid-search"
          aria-label="Search fields by name or key"
          placeholder="Search by name or key"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {select('Belongs To', belongsTo, setBelongsTo, levelOptions)}
        {select('Type', type, setType, typeOptions)}
        {select('Shown In', shownIn, setShownIn, shownInOptions)}
        {select(statusHeading, status, setStatus, statusOptions)}
        {filtered ? <button type="button" className="btn btn-ghost btn-small" onClick={clear}>Clear Filters</button> : null}
        <button type="button" className="btn btn-primary btn-small grid-add" onClick={() => { setAdded(null); setAdding(true) }}>Add Field</button>
      </div>

      {added ? (
        <p className="review-notice" role="status">
          <span>{added}</span>
          <button type="button" className="review-notice-close" aria-label="Dismiss message" onClick={() => setAdded(null)}>×</button>
        </p>
      ) : null}

      <p className="note grid-count" role="status">
        {filtered ? `Showing ${shown.length} of ${rows.length} fields.` : `${rows.length} fields.`}
      </p>

      <div className="table-scroll">
        <table className="fields-grid">
          <thead>
            <tr>
              {heading('name', 'Name')}
              {heading('belongsTo', 'Belongs To')}
              {heading('fieldKey', 'Key')}
              {heading('type', 'Type')}
              {heading('shownIn', 'Shown In')}
              {heading('status', statusHeading)}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id}>
                <td><Link href={row.href}>{row.name}</Link></td>
                <td>{row.belongsTo}</td>
                <td><code className="key">{row.fieldKey}</code></td>
                <td>{row.type}</td>
                <td>{row.shownIn}</td>
                <td><span className={TONE_CLASS[row.statusTone]}>{row.status}</span></td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">No fields match these filters.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <dialog ref={dialog} className="modal" aria-labelledby="add-field-title" onClose={() => setAdding(false)}>
        <div className="modal-head">
          <h2 id="add-field-title">{addTitle}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => setAdding(false)}>×</button>
        </div>
        {adding ? (
          <AddFieldForm
            action={addAction}
            levels={levels}
            types={types}
            places={places}
            onCancel={() => setAdding(false)}
            onDone={(message) => {
              setAdded(message)
              setAdding(false)
            }}
          />
        ) : null}
      </dialog>
    </>
  )
}
