'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useAgentReferences } from '@/components/AgentContext'
import { DataGrid, Modal, type GridColumn, type GridRow } from '@/components/DataGrid'
import { editText, formatValue, type DataType, type StoredValue } from '@/lib/fieldFormat'
import type { Target } from './FieldGroup'
import { removeRow, saveRow } from './actions'

export type ListColumn = {
  id: string
  key: string
  name: string
  dataType: DataType
  unit: string | null
  options: string[] | null
  defaultValue: 'today' | 'currentUser' | null
}

export type ListRowView = {
  id: string
  rowNumber: number
  values: Record<string, StoredValue>
}

/**
 * One record's copy of a list. An asset and each of its properties keep
 * their own entries (and their own columns, which share keys and names);
 * the grid shows them together.
 */
export type ListSource = {
  target: Target
  /** What the entries belong to, for the Belongs To column: "Asset", or the property's name. */
  label: string
  list: { id: string; key: string; name: string }
  columns: ListColumn[]
  rows: ListRowView[]
  /** False when the person's roles only let them see this record's entries. */
  canEdit: boolean
}

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** A number to sort a value by, where its text would sort wrongly. */
function orderOf(column: ListColumn, value: StoredValue | undefined): number | undefined {
  if (!value) return undefined
  if (column.dataType === 'date') return value.date ? Date.parse(`${value.date}T00:00:00Z`) : undefined
  if (column.dataType === 'number' || column.dataType === 'money' || column.dataType === 'percent') return value.number ?? undefined
  return undefined
}

/**
 * A list (comments, critical dates and the like) as one grid: every entry of
 * the asset and of its properties together, sorted, filtered and searched
 * like any other list in the app. Entries are added and changed in a pop-up.
 */
export function ListGrid({
  sources,
  sortKey,
  sortDescending,
  showBelongsTo,
  currentUserName,
}: {
  sources: ListSource[]
  /** The key of the column the list is ordered by, and which way. */
  sortKey: string | null
  sortDescending: boolean
  /** Whether to say which record each entry belongs to; off for an asset with one property, where it adds nothing. */
  showBelongsTo: boolean
  currentUserName: string
}) {
  const router = useRouter()
  const { addReference } = useAgentReferences()
  // null = no pop-up, otherwise which source the entry is for and the row being changed (null for a new one)
  const [editing, setEditing] = useState<{ source: number; rowId: string | null } | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, startBusy] = useTransition()

  // The columns of every source, by key, in the first source's order.
  const columns: ListColumn[] = []
  for (const source of sources) for (const column of source.columns) if (!columns.some((existing) => existing.key === column.key)) columns.push(column)
  const editable = sources.map((source, index) => ({ source, index })).filter((entry) => entry.source.canEdit)
  // A new entry goes on the property unless the person says otherwise.
  const startingSource = (editable.find((entry) => entry.source.target.recordType === 'property') ?? editable[0])?.index ?? 0

  const startingDraft = (source: ListSource) => {
    const starting: Record<string, string> = {}
    for (const column of source.columns) starting[column.key] = column.defaultValue === 'today' ? today() : column.defaultValue === 'currentUser' ? currentUserName : ''
    return starting
  }
  const startAdd = () => {
    setDraft(startingDraft(sources[startingSource]))
    setError(null)
    setConfirmRemove(null)
    setEditing({ source: startingSource, rowId: null })
  }
  const startEdit = (sourceIndex: number, row: ListRowView) => {
    const starting: Record<string, string> = {}
    for (const column of sources[sourceIndex].columns) starting[column.key] = editText(column, row.values[column.id])
    setDraft(starting)
    setError(null)
    setConfirmRemove(null)
    setEditing({ source: sourceIndex, rowId: row.id })
  }

  const save = () => {
    if (!editing) return
    const source = sources[editing.source]
    setError(null)
    startBusy(async () => {
      const values: Record<string, string> = {}
      for (const column of source.columns) values[column.id] = draft[column.key] ?? ''
      const result = await saveRow({ assetId: source.target.assetId, listId: source.list.id, recordType: source.target.recordType, recordId: source.target.recordId, rowId: editing.rowId, values })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setEditing(null)
      router.refresh()
    })
  }

  const remove = (source: ListSource, rowId: string) => {
    setError(null)
    startBusy(async () => {
      const result = await removeRow({ assetId: source.target.assetId, rowId })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setConfirmRemove(null)
      router.refresh()
    })
  }

  const gridColumns: GridColumn[] = [
    ...columns.map((column) => ({ key: column.key, label: column.name, numeric: column.dataType !== 'text' && column.dataType !== 'picklist' && column.dataType !== 'boolean' })),
    ...(showBelongsTo ? [{ key: '_belongs', label: 'Belongs To' }] : []),
    { key: '_actions', label: 'Actions', plain: true },
  ]
  const rows: GridRow[] = sources.flatMap((source, sourceIndex) =>
    source.rows.map((row) => {
      const cells: Record<string, string> = { _belongs: source.label, _actions: '' }
      const order: Record<string, number> = {}
      for (const column of columns) {
        const own = source.columns.find((candidate) => candidate.key === column.key)
        cells[column.key] = own ? formatValue(own, row.values[own.id]) : ''
        const sortBy = own ? orderOf(own, row.values[own.id]) : undefined
        if (sortBy !== undefined && !Number.isNaN(sortBy)) order[column.key] = sortBy
      }
      return {
        id: row.id,
        cells,
        order,
        render: {
          _actions: (
            <div className="row-actions">
              {confirmRemove === row.id ? (
                <>
                  <button type="button" className="link-button danger" disabled={busy} onClick={() => remove(source, row.id)}>Confirm Remove</button>
                  <button type="button" className="link-button" disabled={busy} onClick={() => setConfirmRemove(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="link-button"
                    title="Point the agent at this entry"
                    onClick={() =>
                      addReference({
                        reference: `${source.target.recordRef}.${source.list.key}[${row.rowNumber}]`,
                        label: `${source.target.recordName} · ${source.list.name} #${row.rowNumber}`,
                        detail: source.columns.map((column) => formatValue(column, row.values[column.id])).filter(Boolean).join(' · ') || undefined,
                      })
                    }
                  >
                    Copy to Agent
                  </button>
                  {source.canEdit ? <button type="button" className="link-button" onClick={() => startEdit(sourceIndex, row)}>Edit</button> : null}
                  {source.canEdit ? <button type="button" className="link-button danger" onClick={() => { setError(null); setConfirmRemove(row.id) }}>Remove</button> : null}
                </>
              )}
            </div>
          ),
        },
      }
    }),
  )

  const editingSource = editing ? sources[editing.source] : null
  const formId = `list-${sources[0]?.list.key ?? 'list'}`

  return (
    <div className="list-section">
      {!editing && error ? <p className="form-error" role="alert">{error}</p> : null}
      <DataGrid
        columns={gridColumns}
        rows={rows}
        noun="entries"
        searchColumns={[...columns.filter((column) => column.dataType === 'text' || column.dataType === 'picklist').map((column) => column.key), '_belongs']}
        searchPlaceholder="Search entries"
        emptyText="No entries yet."
        defaultSort={sortKey && columns.some((column) => column.key === sortKey) ? { column: sortKey, descending: sortDescending } : undefined}
        toolbar={editable.length > 0 ? <button type="button" className="btn btn-primary btn-small" onClick={startAdd}>Add Entry</button> : undefined}
      />

      <Modal open={editing !== null} title={editing?.rowId ? 'Edit Entry' : 'Add Entry'} onClose={() => { if (!busy) setEditing(null) }}>
        {editing && editingSource ? (
          <form
            className="list-form"
            onSubmit={(event) => {
              event.preventDefault()
              save()
            }}
          >
            {showBelongsTo && !editing.rowId && editable.length > 1 ? (
              <div className="field">
                <label htmlFor={`${formId}-belongs`}>Belongs To</label>
                <select
                  id={`${formId}-belongs`}
                  value={editing.source}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    // Columns share keys across records, so what has been typed carries over.
                    setDraft((current) => ({ ...startingDraft(sources[next]), ...current }))
                    setEditing({ source: next, rowId: null })
                  }}
                >
                  {editable.map((entry) => (
                    <option key={entry.index} value={entry.index}>{entry.source.label}</option>
                  ))}
                </select>
              </div>
            ) : null}
            {editingSource.columns.map((column, index) => {
              const id = `${formId}-${column.key}`
              const value = draft[column.key] ?? ''
              const set = (next: string) => setDraft((current) => ({ ...current, [column.key]: next }))
              const long = column.dataType === 'text' && !column.defaultValue
              return (
                <div key={column.key} className={`field${long ? ' list-form-wide' : ''}`}>
                  <label htmlFor={id}>{column.name}</label>
                  {column.dataType === 'picklist' && column.options ? (
                    <select id={id} value={value} onChange={(event) => set(event.target.value)} autoFocus={index === 0}>
                      <option value="">Not set</option>
                      {value && !column.options.includes(value) ? <option value={value}>{value}</option> : null}
                      {column.options.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : long ? (
                    <textarea id={id} className="field-textarea" rows={3} value={value} onChange={(event) => set(event.target.value)} maxLength={2000} autoFocus={index === 0} />
                  ) : (
                    <input id={id} type={column.dataType === 'date' ? 'date' : 'text'} value={value} onChange={(event) => set(event.target.value)} maxLength={2000} autoFocus={index === 0} />
                  )}
                </div>
              )
            })}
            {error ? <p className="form-error list-form-wide" role="alert">{error}</p> : null}
            <div className="button-row modal-actions list-form-wide">
              <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy}>{busy ? 'Saving…' : editing.rowId ? 'Save Entry' : 'Add Entry'}</button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  )
}
