'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { removeField, resetSettings, saveSettings } from '../actions'

export type EditableField = {
  id: string
  standard: boolean
  calculated: boolean
  dataType: string
  isListColumn: boolean
  name: string
  aiDescription: string
  otherNames: string[]
  extractionHints: string
  sourcePriority: string[]
  whenEmpty: string
  whenDifferent: string
  manualOverride: string
  unit: string
  options: string[]
  modifiedSettings: string[]
  standardValues: Record<string, unknown>
}

type Source = { key: string; name: string }

const WHEN_EMPTY = [
  { value: 'fill', label: 'Fill Automatically' },
  { value: 'ask', label: 'Ask First' },
]
const WHEN_DIFFERENT = [
  { value: 'ask', label: 'Ask Which to Keep' },
  { value: 'replace', label: 'Replace Automatically' },
  { value: 'never', label: 'Never Replace (Show the Difference)' },
]
const MANUAL_OVERRIDE = [
  { value: 'stays', label: 'Stays Until Someone Changes It' },
  { value: 'replaceable', label: 'Can Be Replaced by a Later Feed' },
]

function when(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function FieldEditor({
  field,
  sections,
  currentSectionId,
  sources,
  modifications,
}: {
  field: EditableField
  sections: { id: string; label: string }[]
  currentSectionId: string | null
  sources: Source[]
  modifications: { setting: string; modifiedAt: string }[]
}) {
  const router = useRouter()
  const [name, setName] = useState(field.name)
  const [aiDescription, setAiDescription] = useState(field.aiDescription)
  const [otherNames, setOtherNames] = useState(field.otherNames.join('\n'))
  const [extractionHints, setExtractionHints] = useState(field.extractionHints)
  const [priority, setPriority] = useState(field.sourcePriority)
  const [whenEmpty, setWhenEmpty] = useState(field.whenEmpty)
  const [whenDifferent, setWhenDifferent] = useState(field.whenDifferent)
  const [manualOverride, setManualOverride] = useState(field.manualOverride)
  const [unit, setUnit] = useState(field.unit)
  const [options, setOptions] = useState(field.options.join('\n'))
  const [sectionId, setSectionId] = useState(currentSectionId ?? '')
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, startBusy] = useTransition()

  const sourceName = (key: string) => sources.find((source) => source.key === key)?.name ?? key
  const unused = sources.filter((source) => !priority.includes(source.key))
  const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const numeric = field.dataType === 'number' || field.dataType === 'money'

  const run = (work: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>, after?: () => void) => {
    setMessage(null)
    startBusy(async () => {
      const result = await work()
      if (!result.ok) {
        setMessage({ text: result.error, error: true })
        return
      }
      setMessage({ text: result.message, error: false })
      if (after) after()
      else router.refresh()
    })
  }

  const save = () =>
    run(() =>
      saveSettings({
        fieldId: field.id,
        settings: {
          name,
          aiDescription,
          otherNames: lines(otherNames),
          extractionHints,
          sourcePriority: priority,
          whenEmpty,
          whenDifferent,
          manualOverride,
          unit,
          options: lines(options),
        },
        sectionId: sectionId || null,
        moveSection: !field.isListColumn && (sectionId || null) !== currentSectionId,
      }),
    )

  // Resetting reloads the page so the form shows the standard values again.
  const reset = (setting: string | null) => run(() => resetSettings({ fieldId: field.id, setting }), () => window.location.reload())

  const move = (index: number, by: number) =>
    setPriority((current) => {
      const next = [...current]
      const target = index + by
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  /** Shows "Modified", the standard value and a reset link beside a setting the organization has changed. */
  const modified = (setting: string, format: (value: unknown) => string = (value) => String(value ?? '')): ReactNode => {
    if (!field.standard || !field.modifiedSettings.includes(setting)) return null
    const changed = modifications.find((item) => item.setting === setting)
    const standard = format(field.standardValues[setting])
    return (
      <span className="modified-note">
        <span className="chip chip-modified">Modified{changed ? ` ${when(changed.modifiedAt)}` : ''}</span>
        <span>Standard: {standard || 'empty'}</span>
        <button type="button" className="link-button" disabled={busy} onClick={() => reset(setting)}>Reset</button>
      </span>
    )
  }
  const asList = (value: unknown) => (Array.isArray(value) ? value.join(', ') : '')
  const asSources = (value: unknown) => (Array.isArray(value) ? value.map((key) => sourceName(String(key))).join(', then ') : '')
  const asChoice = (choices: { value: string; label: string }[]) => (value: unknown) => choices.find((choice) => choice.value === value)?.label ?? String(value ?? '')

  return (
    <form
      className="stack field-editor"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <div className="form-row">
        <div className="field">
          <label htmlFor="fe-name">Name</label>
          <input id="fe-name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          {modified('name')}
        </div>
        {field.isListColumn ? null : (
          <div className="field">
            <label htmlFor="fe-section">Shown In</label>
            <select id="fe-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">{field.standard ? 'Its Standard Section' : 'Other Fields (No Section)'}</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>{section.label}</option>
              ))}
            </select>
          </div>
        )}
        {!field.standard && numeric ? (
          <div className="field field-narrow">
            <label htmlFor="fe-unit">Unit</label>
            <input id="fe-unit" type="text" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={30} />
          </div>
        ) : null}
      </div>

      {!field.standard && field.dataType === 'picklist' ? (
        <div className="field">
          <label htmlFor="fe-options">Options (One per Line)</label>
          <textarea id="fe-options" rows={5} value={options} onChange={(e) => setOptions(e.target.value)} />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="fe-ai">AI Description</label>
        <textarea id="fe-ai" rows={2} value={aiDescription} onChange={(e) => setAiDescription(e.target.value)} maxLength={1000} placeholder="What this field means, in plain words, for the agents" />
        {modified('ai_description')}
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="fe-names">Other Names (One per Line)</label>
          <textarea id="fe-names" rows={4} value={otherNames} onChange={(e) => setOtherNames(e.target.value)} placeholder="What documents and systems may call it" />
          {modified('other_names', asList)}
        </div>
        <div className="field">
          <label htmlFor="fe-hints">Extraction Hints</label>
          <textarea id="fe-hints" rows={4} value={extractionHints} onChange={(e) => setExtractionHints(e.target.value)} maxLength={1000} placeholder="Where and how to find it in a document" />
          {modified('extraction_hints')}
        </div>
      </div>

      {field.calculated ? (
        <p className="note">This field is calculated, so it has no sources to rank.</p>
      ) : (
        <>
          <div className="field">
            <span className="field-title">Source Priority (Highest First)</span>
            <ol className="priority-list">
              {priority.map((key, index) => (
                <li key={key}>
                  <span className="priority-rank">{index + 1}</span>
                  <span className="priority-name">{sourceName(key)}</span>
                  <button type="button" className="link-button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${sourceName(key)} up`}>Up</button>
                  <button type="button" className="link-button" disabled={index === priority.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${sourceName(key)} down`}>Down</button>
                  <button type="button" className="link-button danger" disabled={priority.length === 1} onClick={() => setPriority((current) => current.filter((item) => item !== key))} aria-label={`Remove ${sourceName(key)}`}>Remove</button>
                </li>
              ))}
            </ol>
            {unused.length > 0 ? (
              <div className="priority-add">
                <span>Add:</span>
                {unused.map((source) => (
                  <button key={source.key} type="button" className="preset" onClick={() => setPriority((current) => [...current, source.key])}>{source.name}</button>
                ))}
              </div>
            ) : null}
            {modified('source_priority', asSources)}
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="fe-empty">When the Field Is Empty</label>
              <select id="fe-empty" value={whenEmpty} onChange={(e) => setWhenEmpty(e.target.value)}>
                {WHEN_EMPTY.map((choice) => (
                  <option key={choice.value} value={choice.value}>{choice.label}</option>
                ))}
              </select>
              {modified('when_empty', asChoice(WHEN_EMPTY))}
            </div>
            <div className="field">
              <label htmlFor="fe-different">When a Different Value Arrives</label>
              <select id="fe-different" value={whenDifferent} onChange={(e) => setWhenDifferent(e.target.value)}>
                {WHEN_DIFFERENT.map((choice) => (
                  <option key={choice.value} value={choice.value}>{choice.label}</option>
                ))}
              </select>
              {modified('when_different', asChoice(WHEN_DIFFERENT))}
            </div>
            <div className="field">
              <label htmlFor="fe-override">A Value Picked by Hand</label>
              <select id="fe-override" value={manualOverride} onChange={(e) => setManualOverride(e.target.value)}>
                {MANUAL_OVERRIDE.map((choice) => (
                  <option key={choice.value} value={choice.value}>{choice.label}</option>
                ))}
              </select>
              {modified('manual_override', asChoice(MANUAL_OVERRIDE))}
            </div>
          </div>
          <p className="note">Source priority and these three rules are saved now and take effect when documents and feeds are connected.</p>
        </>
      )}

      <div className="button-row">
        <button type="submit" className="btn btn-primary btn-small" disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</button>
        {field.standard && field.modifiedSettings.length > 0 ? (
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => reset(null)}>Reset All to Standard</button>
        ) : null}
        {field.standard ? null : confirmRemove ? (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-small danger"
              disabled={busy}
              onClick={() => run(() => removeField({ fieldId: field.id }), () => router.push('/dashboard/fields'))}
            >
              Confirm Remove
            </button>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove Field</button>
        )}
      </div>
      {confirmRemove ? <p className="note">Removing hides the field everywhere. Values already entered are kept in the database.</p> : null}
      {message ? <p className={message.error ? 'form-error' : 'form-ok'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
    </form>
  )
}
