'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'

/** How a cell is drawn: a link to the row's page, a small code-style key, a chip, or plain text. */
export type GridColumn = { key: string; label: string; display?: 'link' | 'code' | 'chip' | 'text'; numeric?: boolean }

export type GridTone = 'plain' | 'own' | 'modified' | 'muted'

/** One row, flattened to text on the server by the page that shows the grid. */
export type GridRow = {
  id: string
  href?: string
  /** The text shown in each column, by column key. */
  cells: Record<string, string>
  /** A number to sort a column by when its text would sort wrongly (counts, or a natural order such as Asset before Property). */
  order?: Record<string, number>
  /** For a cell that holds several values ("Office, Retail"): the separate values, so each can be ticked in the filter. */
  values?: Record<string, string[]>
  /** The chip style for a `chip` column. */
  tones?: Record<string, GridTone>
  /** A small picture shown before the row's link, when the grid has `thumbnails` on. */
  image?: string
}

type Sort = { column: string; descending: boolean } | null
/** The values ticked for each filtered column. A column with no entry shows everything. */
type Filters = Record<string, string[]>

const TONE_CLASS: Record<GridTone, string> = { plain: 'chip', own: 'chip chip-own', modified: 'chip chip-modified', muted: 'muted' }
const BLANK = '(Blank)'
const MENU_WIDTH = 270

/** The values a row counts as having in a column, for filtering. An empty cell counts as "(Blank)". */
function valuesOf(row: GridRow, column: string): string[] {
  const values = (row.values?.[column] ?? [row.cells[column] ?? '']).filter((value) => value !== '')
  return values.length > 0 ? values : [BLANK]
}

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
  numeric,
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
  /** Numbers sort smallest to largest instead of A to Z. */
  numeric: boolean
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
        <span className="column-menu-icon" aria-hidden="true">{numeric ? '1↓9' : 'A↓Z'}</span> {numeric ? 'Sort Smallest to Largest' : 'Sort A to Z'}
      </button>
      <button type="button" className={`column-menu-item${sorted === 'descending' ? ' active' : ''}`} onClick={() => onSort(true)}>
        <span className="column-menu-icon" aria-hidden="true">{numeric ? '9↓1' : 'Z↓A'}</span> {numeric ? 'Sort Largest to Smallest' : 'Sort Z to A'}
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

/**
 * A pop-up over the page (a native dialog: Escape closes it and the page
 * behind is dimmed). The contents are only rendered while it is open, so a
 * form inside starts fresh each time.
 */
export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])
  return (
    <dialog ref={dialog} className={wide ? 'modal modal-wide' : 'modal'} aria-label={title} onClose={onClose}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button>
      </div>
      {open ? children : null}
    </dialog>
  )
}

/**
 * A spreadsheet-style grid used by the Assets list and both Fields Library
 * pages. Each column heading opens a menu (sort, and tick the values to
 * show) and a search box narrows by the `searchColumns`. `rows` arrive in
 * their standard order, which is used until a column is sorted. Everything
 * happens in the browser; nothing is remembered between visits.
 */
export function DataGrid({
  columns,
  rows,
  noun,
  searchColumns,
  searchPlaceholder,
  toolbar,
  notice,
  emptyText,
  thumbnails,
}: {
  columns: GridColumn[]
  rows: GridRow[]
  /** What the rows are, plural and lowercase ("fields"), for the count line. */
  noun: string
  searchColumns: string[]
  searchPlaceholder: string
  /** Shown at the right of the search row, for example an Add button. */
  toolbar?: ReactNode
  /** Shown between the search row and the grid, for example a "saved" message. */
  notice?: ReactNode
  /** Shown in the grid when there are no rows at all. */
  emptyText?: string
  /** Leaves room for a small picture before each row's link (rows without one get an empty box). */
  thumbnails?: boolean
}) {
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>({})
  const [sort, setSort] = useState<Sort>(null)
  const [menu, setMenu] = useState<{ column: string; left: number; top: number } | null>(null)

  const closeMenu = useCallback(() => setMenu(null), [])

  const compare = useCallback((column: string, a: GridRow, b: GridRow) => {
    const first = a.order?.[column]
    const second = b.order?.[column]
    if (first !== undefined && second !== undefined && first !== second) return first - second
    return (a.cells[column] ?? '').localeCompare(b.cells[column] ?? '', undefined, { sensitivity: 'base', numeric: true })
  }, [])

  const term = search.trim().toLowerCase()
  const matches = useCallback(
    (row: GridRow, except?: string) =>
      (!term || searchColumns.some((column) => (row.cells[column] ?? '').toLowerCase().includes(term))) &&
      Object.entries(filters).every(([column, ticked]) => column === except || valuesOf(row, column).some((value) => ticked.includes(value))),
    [term, filters, searchColumns],
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
  const valuesFor = (column: string) => {
    const seen = new Map<string, number | undefined>()
    for (const row of rows) {
      if (!matches(row, column)) continue
      // A row's sort number only describes its value when the cell holds a single one.
      const order = row.values?.[column] ? undefined : row.order?.[column]
      for (const value of valuesOf(row, column)) if (!seen.has(value)) seen.set(value, order)
    }
    return [...seen.entries()]
      .sort(([a, first], [b, second]) =>
        a === BLANK ? 1 : b === BLANK ? -1 : first !== undefined && second !== undefined && first !== second ? first - second : a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }),
      )
      .map(([value]) => value)
  }

  const filtered = Boolean(term || Object.keys(filters).length > 0)
  const clear = () => {
    setSearch('')
    setFilters({})
    setSort(null)
  }

  const openMenu = (column: string, button: HTMLElement) => {
    if (menu?.column === column) return setMenu(null)
    const rect = button.getBoundingClientRect()
    setMenu({ column, left: Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)), top: rect.bottom + 4 })
  }

  const heading = (column: GridColumn) => {
    const direction = sort?.column === column.key ? (sort.descending ? 'descending' : 'ascending') : null
    const isFiltered = Boolean(filters[column.key])
    return (
      <th key={column.key} scope="col" aria-sort={direction ?? 'none'}>
        <button
          type="button"
          className={`sort-button${direction || isFiltered ? ' active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={menu?.column === column.key}
          title={`Sort or filter ${column.label}`}
          // Stops the menu's own "clicked outside" check from closing it before this click reopens it.
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => openMenu(column.key, event.currentTarget)}
        >
          {column.label}
          {direction ? <span className="sort-arrow on" aria-hidden="true">{direction === 'descending' ? '↓' : '↑'}</span> : null}
          {isFiltered ? <span className="filter-mark" aria-hidden="true">Filtered</span> : null}
          <span className="sort-arrow" aria-hidden="true">▾</span>
        </button>
      </th>
    )
  }

  const cell = (row: GridRow, column: GridColumn) => {
    const text = row.cells[column.key] ?? ''
    if (column.display === 'link' && row.href) {
      if (!thumbnails) return <Link href={row.href}>{text}</Link>
      return (
        <Link href={row.href} className="grid-thumb-link">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {row.image ? <img className="grid-thumb" src={row.image} alt="" loading="lazy" /> : <span className="grid-thumb grid-thumb-empty" aria-hidden="true" />}
          <span>{text}</span>
        </Link>
      )
    }
    if (column.display === 'code') return <code className="key">{text}</code>
    if (column.display === 'chip') return <span className={TONE_CLASS[row.tones?.[column.key] ?? 'plain']}>{text}</span>
    return text
  }

  const menuColumn = menu ? columns.find((column) => column.key === menu.column) : undefined

  return (
    <>
      <div className="grid-toolbar">
        <input
          type="search"
          className="grid-search"
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {filtered || sort ? <button type="button" className="btn btn-ghost btn-small" onClick={clear}>Clear Filters and Sorting</button> : null}
        {toolbar ? <span className="grid-add">{toolbar}</span> : null}
      </div>

      {notice}

      <p className="note grid-count" role="status">
        {filtered ? `Showing ${shown.length} of ${rows.length} ${noun}.` : `${rows.length} ${noun}.`} Click a column heading to sort or filter.
      </p>

      <div className="table-scroll">
        <table className="fields-grid">
          <thead>
            <tr>{columns.map((column) => heading(column))}</tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td key={column.key}>{cell(row, column)}</td>
                ))}
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="muted">{rows.length === 0 ? emptyText ?? `No ${noun} yet.` : `No ${noun} match these filters.`}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {menu && menuColumn ? (
        <ColumnMenu
          key={menu.column}
          label={menuColumn.label}
          values={valuesFor(menu.column)}
          selected={filters[menu.column] ?? null}
          sorted={sort?.column === menu.column ? (sort.descending ? 'descending' : 'ascending') : null}
          numeric={menuColumn.numeric === true}
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
    </>
  )
}
