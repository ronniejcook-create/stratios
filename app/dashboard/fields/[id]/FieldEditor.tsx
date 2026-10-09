'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { GenerateButton } from '@/components/GenerateButton'
import { RichTextEditor } from '@/components/RichTextEditor'
import { generateDescription, removeField, resetSettings, saveSettings, type ActionResult } from '../actions'
import type { FieldSettingsInput } from '@/lib/fieldAdmin'

type SaveAction = (input: { fieldId: string; settings: FieldSettingsInput; sectionId: string | null; moveSection: boolean }) => Promise<ActionResult>
type RemoveAction = (input: { fieldId: string }) => Promise<ActionResult>

export type EditableField = {
  id: string
  standard: boolean
  calculated: boolean
  dataType: string
  appliesTo: string
  tracking: string
  isListColumn: boolean
  name: string
  aiDescription: string
  agentInstructions: string
  whenEmpty: string
  whenDifferent: string
  manualOverride: string
  unit: string
  options: string[]
  modifiedSettings: string[]
  standardValues: Record<string, unknown>
}

type TypeOption = { value: string; label: string }

const INSTRUCTIONS_EXAMPLE = `### Other Names
- What documents and systems may call this field

### Where to Find It
Which document, section or table usually holds it.

### Source Priority
1. Accounting System
2. Documents
3. Manual Entry

### Rules
Any conversion, rounding or judgment to apply.`

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
  types,
  typeLockedReason,
  modifications,
  saveAction = saveSettings,
  removeAction = removeField,
  backHref = '/dashboard/fields',
  noSectionLabel,
  removeLabel = 'Remove Field',
  removeNote = 'Removing hides the field everywhere. Values already entered are kept in the database.',
  canRemove = true,
}: {
  /** The Master Library passes its own save and remove, which change the standard for every organization. */
  saveAction?: SaveAction
  removeAction?: RemoveAction
  backHref?: string
  noSectionLabel?: string
  removeLabel?: string
  removeNote?: string
  canRemove?: boolean
  field: EditableField
  sections: { id: string; label: string }[]
  currentSectionId: string | null
  /** The field types to choose from. */
  types: TypeOption[]
  /** Why the type can't be changed, or null when it can. */
  typeLockedReason: string | null
  modifications: { setting: string; modifiedAt: string }[]
}) {
  const router = useRouter()
  const [name, setName] = useState(field.name)
  const [aiDescription, setAiDescription] = useState(field.aiDescription)
  const [agentInstructions, setAgentInstructions] = useState(field.agentInstructions)
  const [reading, setReading] = useState(true)
  const [dataType, setDataType] = useState(field.dataType)
  const [whenEmpty, setWhenEmpty] = useState(field.whenEmpty)
  const [whenDifferent, setWhenDifferent] = useState(field.whenDifferent)
  const [manualOverride, setManualOverride] = useState(field.manualOverride)
  const [unit, setUnit] = useState(field.unit)
  const [options, setOptions] = useState(field.options.join('\n'))
  const [sectionId, setSectionId] = useState(currentSectionId ?? '')
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, startBusy] = useTransition()
  const [generating, startGenerating] = useTransition()

  const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const numeric = dataType === 'number' || dataType === 'money'
  const typeEditable = !field.standard && typeLockedReason === null

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
      saveAction({
        fieldId: field.id,
        settings: {
          name,
          aiDescription,
          agentInstructions,
          whenEmpty,
          whenDifferent,
          manualOverride,
          unit,
          options: lines(options),
          ...(typeEditable ? { dataType } : {}),
        },
        sectionId: sectionId || null,
        moveSection: !field.isListColumn && (sectionId || null) !== currentSectionId,
      }),
    )

  // Fills the Description box with Claude's definition. It is not saved until Save Changes.
  const generate = () => {
    setMessage(null)
    startGenerating(async () => {
      const result = await generateDescription({
        name,
        appliesTo: field.appliesTo,
        dataType,
        unit,
        options: lines(options),
        tracking: field.tracking,
        calculated: field.calculated,
      })
      if (!result.ok) {
        setMessage({ text: result.error, error: true })
        return
      }
      setAiDescription(result.description)
      setMessage({ text: 'Description generated. Review it, then save your changes.', error: false })
    })
  }

  // Resetting reloads the page so the form shows the standard values again.
  const reset = (setting: string | null) => run(() => resetSettings({ fieldId: field.id, setting }), () => window.location.reload())

  /** Shows "Modified", the standard value and a reset link beside a setting the organization has changed. */
  const modified = (setting: string, format: (value: unknown) => string = (value) => String(value ?? ''), showStandard = true): ReactNode => {
    if (!field.standard || !field.modifiedSettings.includes(setting)) return null
    const changed = modifications.find((item) => item.setting === setting)
    const standard = format(field.standardValues[setting])
    return (
      <span className="modified-note">
        <span className="chip chip-modified">Modified{changed ? ` ${when(changed.modifiedAt)}` : ''}</span>
        {showStandard ? <span>Standard: {standard || 'empty'}</span> : <span>No longer follows Stratios updates to these instructions.</span>}
        <button type="button" className="link-button" disabled={busy} onClick={() => reset(setting)}>Reset</button>
      </span>
    )
  }
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
              <option value="">{noSectionLabel ?? (field.standard ? 'Its Standard Section' : 'Other Fields (No Section)')}</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>{section.label}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field field-narrow">
          <label htmlFor="fe-type">Type</label>
          <select id="fe-type" value={dataType} onChange={(e) => setDataType(e.target.value)} disabled={!typeEditable} title={typeLockedReason ?? undefined}>
            {types.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </div>
        {!field.standard && numeric ? (
          <div className="field field-narrow">
            <label htmlFor="fe-unit">Unit</label>
            <input id="fe-unit" type="text" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={30} />
          </div>
        ) : null}
      </div>

      {typeLockedReason ? <p className="note">{typeLockedReason}</p> : null}

      {!field.standard && dataType === 'picklist' ? (
        <div className="field">
          <label htmlFor="fe-options">Options (One per Line)</label>
          <textarea id="fe-options" rows={5} value={options} onChange={(e) => setOptions(e.target.value)} />
        </div>
      ) : null}

      <div className="field">
        <div className="label-row">
          <label htmlFor="fe-ai">Description</label>
          <GenerateButton busy={generating} disabled={busy || !name.trim()} onClick={generate} title="Ask AI to write a definition for this field" />
        </div>
        <textarea id="fe-ai" rows={3} value={aiDescription} onChange={(e) => setAiDescription(e.target.value)} maxLength={1000} placeholder="What this field means, in plain words" />
        {modified('ai_description')}
      </div>
      <div className="field">
        <div className="label-row">
          <label id="fe-instructions-label" htmlFor="fe-instructions">Agent Instructions</label>
          <div className="view-toggle" role="group" aria-label="How to show the agent instructions">
            <button type="button" aria-pressed={reading} onClick={() => setReading(true)}>Reading View</button>
            <button type="button" aria-pressed={!reading} onClick={() => setReading(false)}>Markdown</button>
          </div>
        </div>
        {reading ? (
          <RichTextEditor value={agentInstructions} onChange={setAgentInstructions} labelledBy="fe-instructions-label" placeholder="Write the instructions here. Use the buttons above for bold, italic, lists and headings." />
        ) : (
          <textarea
            id="fe-instructions"
            className="instructions-box"
            rows={18}
            value={agentInstructions}
            onChange={(e) => setAgentInstructions(e.target.value)}
            maxLength={20000}
            spellCheck
            placeholder={INSTRUCTIONS_EXAMPLE}
          />
        )}
        {modified('agent_instructions', undefined, false)}
        <p className="note">
          Everything an agent needs to know about this field, written like a skill: other names, where to find it, which source to prefer, how to work it out and how to word it.
          Write in Reading View with the formatting buttons, or in Markdown (# for headings, - for bullets, **bold**); both edit the same text. Saved now; agents start reading it when documents and agents are connected.
        </p>
      </div>

      {field.calculated ? (
        <p className="note">This field is calculated, so the rules for incoming values don&apos;t apply.</p>
      ) : (
        <>
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
              <label htmlFor="fe-override">When a Value is Manually Entered</label>
              <select id="fe-override" value={manualOverride} onChange={(e) => setManualOverride(e.target.value)}>
                {MANUAL_OVERRIDE.map((choice) => (
                  <option key={choice.value} value={choice.value}>{choice.label}</option>
                ))}
              </select>
              {modified('manual_override', asChoice(MANUAL_OVERRIDE))}
            </div>
          </div>
          <p className="note">These three rules are saved now and take effect when documents and feeds are connected.</p>
        </>
      )}

      <div className="button-row">
        <button type="submit" className="btn btn-primary btn-small" disabled={busy || generating}>{busy ? 'Saving…' : 'Save Changes'}</button>
        {field.standard && field.modifiedSettings.length > 0 ? (
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => reset(null)}>Reset All to Standard</button>
        ) : null}
        {field.standard || !canRemove ? null : confirmRemove ? (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-small danger"
              disabled={busy}
              onClick={() => run(() => removeAction({ fieldId: field.id }), () => router.push(backHref))}
            >
              Confirm Remove
            </button>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirmRemove(true)}>{removeLabel}</button>
        )}
      </div>
      {confirmRemove ? <p className="note">{removeNote}</p> : null}
      {message ? <p className={message.error ? 'form-error' : 'form-ok'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
    </form>
  )
}
