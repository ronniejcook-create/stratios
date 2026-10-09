'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAgentReferences } from '@/components/AgentContext'
import { Modal } from '@/components/DataGrid'
import { editText, formatPeriod, formatValue, isEmptyValue, type DataType, type StoredValue } from '@/lib/fieldFormat'
import { toHtml } from '@/lib/richText'
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
  /** What the field means, in plain words. */
  description: string | null
  /** The field's instructions for agents (Markdown): how to find, read and write this value. */
  agentInstructions: string | null
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

/** Text longer than this is shown as a paragraph rather than a one-line value. */
const LONG_TEXT = 90

const TYPE_NAMES: Record<string, string> = { text: 'Text', number: 'Number', money: 'Money', percent: 'Percent', date: 'Date', boolean: 'Yes / No', picklist: 'Pick List' }

/**
 * A group of fields on one record. Each field is a small block with its name
 * on top and its value underneath; clicking either opens the field's pop-up,
 * where the value is edited and its history and skill details are shown.
 * `tiles` is the same block with a larger value, for key figures.
 */
export function FieldGroup({
  target,
  fields,
  style = 'form',
  canManageFields = false,
}: {
  target: Target
  fields: FieldView[]
  style?: 'form' | 'tiles'
  /** Administrators get a link from a field's skill details to where they are edited. */
  canManageFields?: boolean
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  if (fields.length === 0) return <p className="note">No fields in this section yet.</p>
  const open = fields.find((field) => field.id === openId)
  return (
    <>
      <div className={`field-list${style === 'tiles' ? ' tiles' : ''}`}>
        {fields.map((field) => {
          const shown = formatValue(field, field.value)
          // A paragraph (a description, a summary) gets the full width and is cut short; the pop-up shows all of it.
          const long = style !== 'tiles' && !field.calculated && field.dataType === 'text' && shown.length > LONG_TEXT
          return (
            <button key={field.id} type="button" className={`field-card${long ? ' field-card-long' : ''}`} onClick={() => setOpenId(field.id)} title={`Open ${field.name}`}>
              <span className="field-card-label">{field.name}</span>
              <span className="field-card-value">
                {field.calculated ? (
                  <span className="field-unset">Calculated later</span>
                ) : shown ? (
                  <>
                    <span>{shown}</span>
                    {field.monthly && field.period ? <span className="field-meta">{formatPeriod(field.period)}</span> : null}
                  </>
                ) : (
                  <span className="field-unset">Not set</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
      <Modal open={open !== undefined} title={open?.name ?? ''} onClose={() => setOpenId(null)}>
        {open ? <FieldDetails key={open.id} target={target} field={open} canManageFields={canManageFields} onClose={() => setOpenId(null)} /> : null}
      </Modal>
    </>
  )
}

type Tab = 'value' | 'history' | 'skill'

/** The inside of a field's pop-up: Edit, History and Skill Details tabs, with Copy to Agent, Save, Reset and Close. */
function FieldDetails({ target, field, canManageFields, onClose }: { target: Target; field: FieldView; canManageFields: boolean; onClose: () => void }) {
  const router = useRouter()
  const { addReference } = useAgentReferences()
  const editable = field.canEdit && !field.calculated
  const startRaw = editText(field, field.value)
  const startMonth = field.period ? field.period.slice(0, 7) : thisMonth()
  const [tab, setTab] = useState<Tab>('value')
  const [raw, setRaw] = useState(startRaw)
  const [month, setMonth] = useState(startMonth)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loadingHistory, startLoadingHistory] = useTransition()

  // After a save the page sends the new value down; the boxes follow it, so Reset goes back to what is saved now.
  useEffect(() => {
    setRaw(startRaw)
    setMonth(startMonth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startRaw, startMonth])

  const shown = formatValue(field, field.value)
  const inputId = `field-${target.recordId}-${field.id}`
  const numeric = field.dataType === 'number' || field.dataType === 'money' || field.dataType === 'percent'
  const changed = raw !== startRaw || note !== '' || (field.monthly && month !== startMonth)

  const save = () => {
    setError(null)
    setMessage(null)
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
      setNote('')
      setHistory(null) // read again the next time the History tab is opened
      setMessage('Saved.')
      router.refresh()
    })
  }

  const reset = () => {
    setRaw(startRaw)
    setMonth(startMonth)
    setNote('')
    setError(null)
    setMessage(null)
  }

  const showHistory = () => {
    setTab('history')
    if (history || loadingHistory) return
    setHistoryError(null)
    startLoadingHistory(async () => {
      const result = await loadHistory({ recordType: target.recordType, recordId: target.recordId, fieldId: field.id })
      if (result.ok) setHistory(result.entries)
      else setHistoryError(result.error)
    })
  }

  // Points the agent at exactly this value, the same as the reference chips in the agent column.
  const copyToAgent = () => {
    addReference({
      reference: `${target.recordRef}.${field.key}${field.monthly && field.period ? `@${field.period.slice(0, 7)}` : ''}`,
      label: `${target.recordName} · ${field.name}`,
      detail: field.calculated ? undefined : shown ? `${shown}${field.monthly && field.period ? ` (${formatPeriod(field.period)})` : ''}` : 'Not set',
    })
    setError(null)
    setMessage('Added to the agent column. Close this to ask the analyst about it.')
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'value', label: editable ? 'Edit' : 'Value' },
    { key: 'history', label: 'History' },
    { key: 'skill', label: 'Skill Details' },
  ]

  return (
    <form
      className="field-modal"
      onSubmit={(event) => {
        event.preventDefault()
        if (editable && tab === 'value' && changed && !saving) save()
      }}
    >
      <p className="doc-sub">{target.recordName}</p>
      <div className="screen-tabs field-tabs" role="tablist" aria-label={`${field.name} details`}>
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            id={`${inputId}-tab-${entry.key}`}
            aria-selected={tab === entry.key}
            aria-controls={`${inputId}-panel-${entry.key}`}
            className={`screen-tab${tab === entry.key ? ' active' : ''}`}
            onClick={() => (entry.key === 'history' ? showHistory() : setTab(entry.key))}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="field-modal-body" role="tabpanel" id={`${inputId}-panel-${tab}`} aria-labelledby={`${inputId}-tab-${tab}`}>
        {tab === 'value' ? (
          editable ? (
            <>
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
                ) : field.dataType === 'text' ? (
                  // Grows with what is typed, from one line for a short value to a paragraph for a summary.
                  <textarea
                    id={inputId}
                    className="field-textarea"
                    rows={Math.min(12, Math.max(1, Math.ceil(raw.length / 62) + (raw.match(/\n/g)?.length ?? 0)))}
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter saves a short one-line value, as it would in a plain box; in a paragraph it starts a new line (Ctrl+Enter saves).
                      if (e.key !== 'Enter' || e.shiftKey) return
                      if (e.ctrlKey || e.metaKey || (raw.length <= LONG_TEXT && !raw.includes('\n'))) {
                        e.preventDefault()
                        e.currentTarget.form?.requestSubmit()
                      }
                    }}
                    maxLength={2000}
                    autoFocus
                  />
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
                <div className="field">
                  <label htmlFor={`${inputId}-month`}>Month</label>
                  <input id={`${inputId}-month`} type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
                </div>
              ) : null}
              <div className="field">
                <label htmlFor={`${inputId}-note`}>Note (Optional)</label>
                <input id={`${inputId}-note`} type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Why it changed" />
              </div>
              {field.sourceName && shown ? <p className="doc-sub">The current value is from {field.sourceName}.</p> : null}
            </>
          ) : (
            <>
              <p className={`field-modal-value${field.dataType === 'text' && shown.length > LONG_TEXT ? ' field-modal-long' : ''}`}>
                {field.calculated ? 'Calculated later' : shown || 'Not set'}
                {!field.calculated && shown && field.monthly && field.period ? <span className="field-meta"> {formatPeriod(field.period)}</span> : null}
              </p>
              <p className="note">
                {field.calculated ? field.formula ?? 'This value will be worked out from other fields.' : 'Your role can view this field but not change it.'}
              </p>
            </>
          )
        ) : null}

        {tab === 'history' ? (
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
              <p className="note">No changes recorded yet.{field.sourceName && shown ? ` The current value is from ${field.sourceName}.` : ''}</p>
            )}
          </div>
        ) : null}

        {tab === 'skill' ? (
          <div className="field-skill">
            <dl className="field-facts">
              <div><dt>Type</dt><dd>{TYPE_NAMES[field.dataType] ?? field.dataType}{field.unit ? ` (${field.unit})` : ''}{field.monthly ? ', a value per month' : ''}{field.calculated ? ', calculated' : ''}</dd></div>
              <div><dt>Key</dt><dd><code className="key">{field.key}</code></dd></div>
            </dl>
            <h3>Description</h3>
            {field.description ? <p>{field.description}</p> : <p className="note">No description has been written for this field.</p>}
            <h3>Agent Instructions</h3>
            {field.agentInstructions ? (
              // toHtml escapes everything it is given, so the instructions can only ever show as formatted text.
              <div className="markdown field-instructions" dangerouslySetInnerHTML={{ __html: toHtml(field.agentInstructions) }} />
            ) : (
              <p className="note">No instructions have been written. Agents go by the field&apos;s name and description.</p>
            )}
            {canManageFields ? (
              <p className="doc-sub"><Link href={`/dashboard/fields/${field.id}`}>Edit This Field in Fields Library</Link></p>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-ok" role="status">{message}</p> : null}

      <div className="field-modal-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={copyToAgent} title="Add this field to the agent column so the analyst knows which value you mean">Copy to Agent</button>
        <span className="field-modal-spacer" />
        {editable ? (
          <>
            <button type="submit" className="btn btn-primary btn-small" disabled={saving || !changed || tab !== 'value'}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn btn-ghost btn-small" disabled={saving || !changed} onClick={reset}>Reset</button>
          </>
        ) : null}
        <button type="button" className="btn btn-ghost btn-small" disabled={saving} onClick={onClose}>Close</button>
      </div>
    </form>
  )
}
