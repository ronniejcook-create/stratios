'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useAgentReferences } from '@/components/AgentContext'
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

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * A list on one record: one row per entry, with a form to add or change an
 * entry. Rows arrive already in the list's order.
 */
export function ListSection({
  target,
  list,
  columns,
  rows,
  currentUserName,
  canEdit,
}: {
  target: Target
  list: { id: string; key: string; name: string }
  columns: ListColumn[]
  rows: ListRowView[]
  currentUserName: string
  /** False when the person's roles only let them see this list. */
  canEdit: boolean
}) {
  const router = useRouter()
  const { addReference } = useAgentReferences()
  // null = no form open, 'new' = adding, otherwise the id of the row being changed
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, startBusy] = useTransition()

  const startAdd = () => {
    const starting: Record<string, string> = {}
    for (const column of columns) {
      starting[column.id] = column.defaultValue === 'today' ? today() : column.defaultValue === 'currentUser' ? currentUserName : ''
    }
    setDraft(starting)
    setError(null)
    setConfirmRemove(null)
    setEditing('new')
  }

  const startEdit = (row: ListRowView) => {
    const starting: Record<string, string> = {}
    for (const column of columns) starting[column.id] = editText(column, row.values[column.id])
    setDraft(starting)
    setError(null)
    setConfirmRemove(null)
    setEditing(row.id)
  }

  const save = () => {
    setError(null)
    startBusy(async () => {
      const result = await saveRow({
        assetId: target.assetId,
        listId: list.id,
        recordType: target.recordType,
        recordId: target.recordId,
        rowId: editing === 'new' ? null : editing,
        values: draft,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setEditing(null)
      router.refresh()
    })
  }

  const remove = (rowId: string) => {
    setError(null)
    startBusy(async () => {
      const result = await removeRow({ assetId: target.assetId, rowId })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setConfirmRemove(null)
      router.refresh()
    })
  }

  const formId = `list-${list.id}-${target.recordId}`

  return (
    <div className="list-section">
      {rows.length === 0 ? (
        <p className="empty">No entries yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col" className="list-number">#</th>
                {columns.map((column) => (
                  <th key={column.id} scope="col">{column.name}</th>
                ))}
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={editing === row.id ? 'list-row-editing' : undefined}>
                  <td className="list-number">
                    <button
                      type="button"
                      className="link-button list-ref"
                      title="Reference this entry in the agent panel"
                      onClick={() =>
                        addReference({
                          reference: `${target.recordRef}.${list.key}[${row.rowNumber}]`,
                          label: `${target.recordName} · ${list.name} #${row.rowNumber}`,
                          detail: columns.map((column) => formatValue(column, row.values[column.id])).filter(Boolean).join(' · ') || undefined,
                        })
                      }
                    >
                      {row.rowNumber}
                    </button>
                  </td>
                  {columns.map((column) => (
                    <td key={column.id}>{formatValue(column, row.values[column.id])}</td>
                  ))}
                  <td>
                    {canEdit ? (
                    <div className="row-actions">
                      {confirmRemove === row.id ? (
                        <>
                          <button type="button" className="link-button danger" disabled={busy} onClick={() => remove(row.id)}>Confirm Remove</button>
                          <button type="button" className="link-button" disabled={busy} onClick={() => setConfirmRemove(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="link-button" onClick={() => startEdit(row)}>Edit</button>
                          <button type="button" className="link-button danger" onClick={() => { setEditing(null); setConfirmRemove(row.id) }}>Remove</button>
                        </>
                      )}
                    </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          {columns.map((column, index) => {
            const id = `${formId}-${column.id}`
            const value = draft[column.id] ?? ''
            const set = (next: string) => setDraft((current) => ({ ...current, [column.id]: next }))
            const wide = column.dataType === 'text' && !column.defaultValue
            return (
              <div key={column.id} className={`field${wide ? ' field-wide' : column.dataType === 'date' ? ' field-narrow' : ''}`}>
                <label htmlFor={id}>{column.name}</label>
                {column.dataType === 'picklist' && column.options ? (
                  <select id={id} value={value} onChange={(e) => set(e.target.value)} autoFocus={index === 0}>
                    <option value="">Not set</option>
                    {value && !column.options.includes(value) ? <option value={value}>{value}</option> : null}
                    {column.options.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    type={column.dataType === 'date' ? 'date' : 'text'}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    maxLength={2000}
                    autoFocus={index === 0}
                  />
                )}
              </div>
            )
          })}
          <div className="field-edit-buttons">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
              {busy ? 'Saving…' : editing === 'new' ? 'Add Entry' : 'Save Entry'}
            </button>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      ) : canEdit ? (
        <button type="button" className="link-button add-link" onClick={startAdd}>+ Add Entry</button>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  )
}
