'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useAgentReferences } from '@/components/AgentContext'
import { editText, formatPeriod, formatValue, isEmptyValue, type DataType, type StoredValue } from '@/lib/fieldFormat'
import { loadHistory, saveField, type HistoryRow } from './actions'

export type FieldView = {
  id: string
  key: string
  name: string
  dataType: DataType
  unit: string | null
  options: string[] | null
  monthly: boolean
  calculated: boolean
  formula: string | null
  /** The golden record (for a monthly field, its most recent month), or null when not set. */
  value: StoredValue | null
  period: string | null
  sourceName: string | null
  /** False when the person's roles only let them see this field. */
  canEdit: boolean
}

export type Target = {
  assetId: string
  recordType: string
  recordId: string
  /** The record's permanent address, e.g. property:120-main-st */
  recordRef: string
  recordName: string
}

function thisMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function when(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * A group of fields on one record, each with its value, an edit form and its
 * history. Shown as a form (label and value on a line) or as tiles.
 */
export function FieldGroup({ target, fields, style = 'form' }: { target: Target; fields: FieldView[]; style?: 'form' | 'tiles' }) {
  if (fields.length === 0) return <p className="note">No fields in this section yet.</p>
  return (
    <div className={`field-list${style === 'tiles' ? ' tiles' : ''}`}>
      {fields.map((field) => (
        <FieldRow key={field.id} target={target} field={field} />
      ))}
    </div>
  )
}

function FieldRow({ target, field }: { target: Target; field: FieldView }) {
  const router = useRouter()
  const { addReference } = useAgentReferences()
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const [month, setMonth] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loadingHistory, startLoadingHistory] = useTransition()

  const shown = formatValue(field, field.value)
  const inputId = `field-${target.recordId}-${field.id}`

  const startEdit = () => {
    setRaw(editText(field, field.value))
    setMonth(field.period ? field.period.slice(0, 7) : thisMonth())
    setNote('')
    setError(null)
    setEditing(true)
  }

  const save = () => {
    setError(null)
    startSaving(async () => {
      const result = await saveField({
        assetId: target.assetId,
        recordType: target.recordType,
        recordId: target.recordId,
        fieldId: field.id,
        month: field.monthly ? month : null,
        raw,
        note: note || null,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setEditing(false)
      setHistory(null) // reload next time it is opened
      setHistoryOpen(false)
      router.refresh()
    })
  }

  const toggleHistory = () => {
    if (historyOpen) {
      setHistoryOpen(false)
      return
    }
    setHistoryOpen(true)
    if (history) return
    setHistoryError(null)
    startLoadingHistory(async () => {
      const result = await loadHistory({ recordType: target.recordType, recordId: target.recordId, fieldId: field.id })
      if (result.ok) setHistory(result.entries)
      else setHistoryError(result.error)
    })
  }

  const numeric = field.dataType === 'number' || field.dataType === 'money' || field.dataType === 'percent'

  // Clicking the field's name points the agent at exactly this value.
  const reference = () =>
    addReference({
      reference: `${target.recordRef}.${field.key}${field.monthly && field.period ? `@${field.period.slice(0, 7)}` : ''}`,
      label: `${target.recordName} · ${field.name}`,
      detail: field.calculated ? undefined : shown ? `${shown}${field.monthly && field.period ? ` (${formatPeriod(field.period)})` : ''}` : 'Not set',
    })

  return (
    <div className={`field-row${editing || historyOpen ? ' open' : ''}`}>
      <div className="field-line">
        <button type="button" className="field-label" title="Reference this field in the agent panel" onClick={reference}>
          {field.name}
        </button>
        <div className="field-value">
          {field.calculated ? (
            <span className="field-unset" title={field.formula ?? undefined}>Calculated later</span>
          ) : shown ? (
            <>
              <span>{shown}</span>
              {field.monthly && field.period ? <span className="field-meta">{formatPeriod(field.period)}</span> : null}
            </>
          ) : (
            <span className="field-unset">Not set</span>
          )}
        </div>
        <div className="field-actions">
          {field.calculated ? null : (
            <>
              {editing || !field.canEdit ? null : <button type="button" className="link-button" onClick={startEdit}>Edit</button>}
              <button type="button" className="link-button" aria-expanded={historyOpen} onClick={toggleHistory}>History</button>
            </>
          )}
        </div>
      </div>

      {field.calculated && field.formula ? <p className="field-hint">{field.formula}</p> : null}

      {editing ? (
        <form
          className="field-edit"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <div className="field">
            <label htmlFor={inputId}>{field.name}{field.unit && numeric ? ` (${field.unit})` : field.dataType === 'percent' ? ' (%)' : ''}</label>
            {field.dataType === 'picklist' && field.options ? (
              <select id={inputId} value={raw} onChange={(e) => setRaw(e.target.value)} autoFocus>
                <option value="">Not set</option>
                {/* Keep a value from before the list existed selectable. */}
                {raw && !field.options.includes(raw) ? <option value={raw}>{raw}</option> : null}
                {field.options.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            ) : field.dataType === 'boolean' ? (
              <select id={inputId} value={raw} onChange={(e) => setRaw(e.target.value)} autoFocus>
                <option value="">Not set</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            ) : (
              <input
                id={inputId}
                type={field.dataType === 'date' ? 'date' : 'text'}
                inputMode={numeric ? 'decimal' : undefined}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                maxLength={2000}
                autoFocus
              />
            )}
          </div>
          {field.monthly ? (
            <div className="field field-narrow">
              <label htmlFor={`${inputId}-month`}>Month</label>
              <input id={`${inputId}-month`} type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor={`${inputId}-note`}>Note (Optional)</label>
            <input id={`${inputId}-note`} type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Why it changed" />
          </div>
          <div className="field-edit-buttons">
            <button type="submit" className="btn btn-primary btn-small" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn btn-ghost btn-small" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </form>
      ) : null}

      {historyOpen ? (
        <div className="field-history">
          {loadingHistory ? (
            <p className="note">Loading history…</p>
          ) : historyError ? (
            <p className="form-error" role="alert">{historyError}</p>
          ) : history && history.length > 0 ? (
            <ul>
              {history.map((entry, index) => (
                <li key={index}>
                  <span className="history-change">
                    {isEmptyValue(entry.oldValue) ? 'Set to ' : `${formatValue(field, entry.oldValue)} → `}
                    {isEmptyValue(entry.newValue) ? 'cleared' : formatValue(field, entry.newValue)}
                    {entry.period ? ` for ${formatPeriod(entry.period)}` : ''}
                  </span>
                  <span className="field-meta">
                    {when(entry.changedAt)} · {entry.changedByName} · {entry.sourceName}
                  </span>
                  {entry.note ? <span className="history-note">{entry.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">No changes recorded yet.{field.sourceName && shown ? ` Current value is from ${field.sourceName}.` : ''}</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
