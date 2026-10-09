'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
/** The values ticked for each filtered column. A column with no entry shows everything. */
type Filters = Partial<Record<ColumnKey, string[]>>

const COLUMNS: ColumnKey[] = ['name', 'belongsTo', 'fieldKey', 'type', 'shownIn', 'status']

const TONE_CLASS: Record<FieldRow['statusTone'], string> = { plain: 'chip', own: 'chip chip-own', modified: 'chip chip-modified', muted: 'muted' }


/**
 * The menu under a column heading, modeled on a spreadsheet's: sort either
 * way, clear the column's filter, and a searchable list of the column's
 * values with a tick box each. Nothing changes until OK.
 */
function ColumnMenu({
  label,
  values,
  selected,
  sorted,
  left,
  top,
  onSort,
  onApply,
  onClose,
}: {
  label: string
  /** Every value the column can show, in the order to list them. */
  values: string[]
  /** The values currently ticked; null when the column isn't filtered. */
  selected: string[] | null
  sorted: 'ascending' | 'descending' | null
  left: number
  top: number
  onSort: (descending: boolean) => void
  onApply: (selected: string[] | null) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [ticked, setTicked] = useState<string[]>(selected ?? values)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) onClose()
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // The menu is pinned to the screen, so it closes when the page behind it scrolls.
    const scrolled = (event: Event) => {
      if (box.current && !box.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    document.addEventListener('scroll', scrolled, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('scroll', scrolled, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const term = search.trim().toLowerCase()
  const visible = term ? values.filter((value) => value.toLowerCase().includes(term)) : values
  const allVisibleTicked = visible.length > 0 && visible.every((value) => ticked.includes(value))
  const toggle = (value: string) => setTicked((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))
  const toggleAll = () =>
    setTicked((current) => (allVisibleTicked ? current.filter((value) => !visible.includes(value)) : [...new Set([...current, ...visible])]))

  // With a search typed, OK keeps only the ticked values that match it, as a spreadsheet does.
  const chosen = values.filter((value) => ticked.includes(value) && (!term || visible.includes(value)))
  const apply = () => onApply(chosen.length === values.length ? null : chosen)

  return (
    <div ref={box} className="column-menu" role="dialog" aria-label={`Sort and filter ${label}`} style={{ left, top }}>
      <button type="button" className={`column-menu-item${sorted === 'ascending' ? ' active' : ''}`} onClick={() => onSort(false)}>
        <span className="column-menu-icon" aria-hidden="true">A↓Z</span> Sort A to Z
      </button>
      <button type="button" className={`column-menu-item${sorted === 'descending' ? ' active' : ''}`} onClick={() => onSort(true)}>
        <span className="column-menu-icon" aria-hidden="true">Z↓A</span> Sort Z to A
      </button>
      <hr />
      <button type="button" className="column-menu-item" disabled={selected === null} onClick={() => onApply(null)}>
        <span className="column-menu-icon" aria-hidden="true">✕</span> Clear Filter From &quot;{label}&quot;
      </button>
      <hr />
      <input
        type="search"
        className="column-menu-search"
        aria-label={`Search ${label} values`}
        placeholder="Search"
        autoFocus
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && chosen.length > 0) apply()
        }}
      />
      <div className="column-menu-list">
        {visible.length > 0 ? (
          <label>
            <input type="checkbox" checked={allVisibleTicked} onChange={toggleAll} />
            {term ? '(Select All Search Results)' : '(Select All)'}
          </label>
        ) : (
          <p className="muted">No values match.</p>
        )}
        {visible.map((value) => (
          <label key={value}>
            <input type="checkbox" checked={ticked.includes(value)} onChange={() => toggle(value)} />
            {value}
          </label>
        ))}
      </div>
      <div className="column-menu-actions">
        <button type="button" className="btn btn-primary btn-small" disabled={chosen.length === 0} onClick={apply}>OK</button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

const MENU_WIDTH = 270

/**
 * The Fields Library grid: one row per field. Each column heading opens a
 * spreadsheet-style menu (sort, and tick the values to show); there is also a
 * search box for name or key, and Add Field in a pop-up. `rows` arrive in the
 * standard order (level, then where shown), used until a column is sorted.
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
  /** The levels in their natural order (Asset first), for listing and sorting that column. */
  belongsToOrder: string[]
  addTitle: string
  addAction?: FormAction
  levels: LevelOption[]
  types: LevelOption[]
  places: PlaceOption[]
}) {
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>({})
  const [sort, setSort] = useState<Sort>(null)
  const [menu, setMenu] = useState<{ column: ColumnKey; left: number; top: number } | null>(null)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (adding && !element.open) element.showModal()
    if (!adding && element.open) element.close()
  }, [adding])

  const closeMenu = useCallback(() => setMenu(null), [])

  const compare = useCallback(
    (column: ColumnKey, a: FieldRow, b: FieldRow) => {
      if (column === 'belongsTo') return belongsToOrder.indexOf(a.belongsTo) - belongsToOrder.indexOf(b.belongsTo)
      if (column === 'status') return a.statusOrder - b.statusOrder || a.status.localeCompare(b.status)
      return a[column].localeCompare(b[column], undefined, { sensitivity: 'base' })
    },
    [belongsToOrder],
  )

  const term = search.trim().toLowerCase()
  const matches = useCallback(
    (row: FieldRow, except?: ColumnKey) =>
      (!term || row.name.toLowerCase().includes(term) || row.fieldKey.toLowerCase().includes(term)) &&
      COLUMNS.every((column) => column === except || !filters[column] || filters[column]!.includes(row[column])),
    [term, filters],
  )

  const shown = useMemo(() => {
    const kept = rows.filter((row) => matches(row))
    if (!sort) return kept
    // Ties keep the standard order, so a sorted column still reads sensibly.
    return kept
      .map((row, index) => ({ row, index }))
      .sort((a, b) => (sort.descending ? -1 : 1) * compare(sort.column, a.row, b.row) || a.index - b.index)
      .map((entry) => entry.row)
  }, [rows, matches, sort, compare])

  // A column's menu lists the values left by the other columns' filters, as a spreadsheet does.
  const valuesFor = (column: ColumnKey) => {
    const seen = new Map<string, FieldRow>()
    for (const row of rows) if (matches(row, column) && !seen.has(row[column])) seen.set(row[column], row)
    return [...seen.values()].sort((a, b) => compare(column, a, b)).map((row) => row[column])
  }

  const filtered = Boolean(term || COLUMNS.some((column) => filters[column]))
  const changed = filtered || sort !== null
  const clear = () => {
    setSearch('')
    setFilters({})
    setSort(null)
  }

  const openMenu = (column: ColumnKey, button: HTMLElement) => {
    if (menu?.column === column) return setMenu(null)
    const rect = button.getBoundingClientRect()
    setMenu({ column, left: Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)), top: rect.bottom + 4 })
  }

  const labels: Record<ColumnKey, string> = { name: 'Name', belongsTo: 'Belongs To', fieldKey: 'Key', type: 'Type', shownIn: 'Shown In', status: statusHeading }

  const heading = (column: ColumnKey) => {
    const direction = sort?.column === column ? (sort.descending ? 'descending' : 'ascending') : null
    const isFiltered = Boolean(filters[column])
    return (
      <th key={column} scope="col" aria-sort={direction ?? 'none'}>
        <button
          type="button"
          className={`sort-button${direction || isFiltered ? ' active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={menu?.column === column}
          title={`Sort or filter ${labels[column]}`}
          // Stops the menu's own "clicked outside" check from closing it before this click reopens it.
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => openMenu(column, event.currentTarget)}
        >
          {labels[column]}
          {direction ? <span className="sort-arrow on" aria-hidden="true">{direction === 'descending' ? '↓' : '↑'}</span> : null}
          {isFiltered ? <span className="filter-mark" aria-hidden="true">Filtered</span> : null}
          <span className="sort-arrow" aria-hidden="true">▾</span>
        </button>
      </th>
    )
  }

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
        {changed ? <button type="button" className="btn btn-ghost btn-small" onClick={clear}>Clear Filters and Sorting</button> : null}
        <button type="button" className="btn btn-primary btn-small grid-add" onClick={() => { setAdded(null); setAdding(true) }}>Add Field</button>
      </div>

      {added ? (
        <p className="review-notice" role="status">
          <span>{added}</span>
          <button type="button" className="review-notice-close" aria-label="Dismiss message" onClick={() => setAdded(null)}>×</button>
        </p>
      ) : null}

      <p className="note grid-count" role="status">
        {filtered ? `Showing ${shown.length} of ${rows.length} fields.` : `${rows.length} fields.`} Click a column heading to sort or filter.
      </p>

      <div className="table-scroll">
        <table className="fields-grid">
          <thead>
            <tr>{COLUMNS.map((column) => heading(column))}</tr>
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

      {menu ? (
        <ColumnMenu
          key={menu.column}
          label={labels[menu.column]}
          values={valuesFor(menu.column)}
          selected={filters[menu.column] ?? null}
          sorted={sort?.column === menu.column ? (sort.descending ? 'descending' : 'ascending') : null}
          left={menu.left}
          top={menu.top}
          onSort={(descending) => {
            setSort({ column: menu.column, descending })
            setMenu(null)
          }}
          onApply={(selected) => {
            setFilters((current) => {
              const next = { ...current }
              if (selected) next[menu.column] = selected
              else delete next[menu.column]
              return next
            })
            setMenu(null)
          }}
          onClose={closeMenu}
        />
      ) : null}

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
