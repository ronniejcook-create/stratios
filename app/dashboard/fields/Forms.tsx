'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { GenerateButton } from '@/components/GenerateButton'
import { addField, addScreen, addSection, generateDescription, type FormState } from './actions'

const initialState: FormState = { error: null, message: null, done: 0 }

/** A form's server action. Each form uses the organization's own by default; the Master Library passes its own. */
export type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>

export type LevelOption = { value: string; label: string }
export type PlaceOption = { value: string; label: string; appliesTo: string }

function Feedback({ state }: { state: FormState }) {
  if (state.error) return <p className="form-error" role="alert">{state.error}</p>
  if (state.message) return <p className="form-ok" role="status">{state.message}</p>
  return null
}

/** Clears a form after each successful submit. */
function useResetOnDone(done: number) {
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (done > 0) ref.current?.reset()
  }, [done])
  return ref
}

export function AddFieldForm({
  levels,
  types,
  places,
  action = addField,
  onDone,
  onCancel,
}: {
  action?: FormAction
  /** Called with the success message once the field is added (the pop-up closes itself with it). */
  onDone?: (message: string) => void
  onCancel?: () => void
  levels: LevelOption[]
  types: LevelOption[]
  /** Sections ("section:<id>") and lists ("list:<id>") a field can be shown in. */
  places: PlaceOption[]
}) {
  const [state, formAction, pending] = useActionState(action, initialState)
  const [level, setLevel] = useState(levels[0]?.value ?? 'asset')
  const [type, setType] = useState('text')
  const [showIn, setShowIn] = useState('')
  const [description, setDescription] = useState('')
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generating, startGenerating] = useTransition()
  const formRef = useResetOnDone(state.done)
  const finished = useRef(onDone)
  finished.current = onDone
  useEffect(() => {
    if (state.done > 0) {
      setType('text')
      setShowIn('')
      setDescription('')
      finished.current?.(state.message ?? 'The field was added.')
    }
  }, [state.done, state.message])

  // Fills the Description box from what has been typed into the form so far.
  const generate = () => {
    const data = new FormData(formRef.current ?? undefined)
    const name = String(data.get('name') ?? '').trim()
    if (!name) {
      setGenerateError('Give the field a name first.')
      return
    }
    setGenerateError(null)
    startGenerating(async () => {
      const result = await generateDescription({
        name,
        appliesTo: level,
        dataType: type,
        unit: String(data.get('unit') ?? ''),
        options: String(data.get('options') ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        tracking: String(data.get('tracking') ?? ''),
      })
      if (result.ok) setDescription(result.description)
      else setGenerateError(result.error)
    })
  }

  const numeric = type === 'number' || type === 'money' || type === 'percent'
  const inList = showIn.startsWith('list:')
  const available = places.filter((place) => place.appliesTo === level)

  return (
    <form action={formAction} ref={formRef}>
      <div className="form-row">
        <div className="field">
          <label htmlFor="new-field-name">Name</label>
          <input id="new-field-name" name="name" type="text" required maxLength={100} placeholder="Zoning" />
        </div>
        <div className="field">
          <label htmlFor="new-field-level">Belongs To</label>
          <select
            id="new-field-level"
            name="appliesTo"
            value={level}
            onChange={(e) => {
              setLevel(e.target.value)
              setShowIn('')
            }}
          >
            {levels.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-field-type">Type</label>
          <select id="new-field-type" name="dataType" value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-field-place">Show In</label>
          <select id="new-field-place" name="showIn" value={showIn} onChange={(e) => setShowIn(e.target.value)}>
            <option value="">Other Fields (No Section)</option>
            {available.map((place) => (
              <option key={place.value} value={place.value}>{place.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        {numeric && type !== 'percent' ? (
          <div className="field field-narrow">
            <label htmlFor="new-field-unit">Unit (Optional)</label>
            <input id="new-field-unit" name="unit" type="text" maxLength={30} placeholder={type === 'money' ? 'USD' : 'SF'} />
          </div>
        ) : null}
        {numeric && !inList ? (
          <div className="field field-narrow">
            <label htmlFor="new-field-tracking">Tracking</label>
            <select id="new-field-tracking" name="tracking" defaultValue="single">
              <option value="single">One Current Value</option>
              <option value="monthly">A Value per Month</option>
            </select>
          </div>
        ) : null}
        {type === 'picklist' ? (
          <div className="field">
            <label htmlFor="new-field-options">Options (One per Line)</label>
            <textarea id="new-field-options" name="options" rows={4} required placeholder={'Commercial\nMixed Use\nIndustrial'} />
          </div>
        ) : null}
        <div className="field field-wide">
          <div className="label-row">
            <label htmlFor="new-field-ai">Description (Optional)</label>
            <GenerateButton busy={generating} disabled={pending} onClick={generate} title="Ask AI to write a definition for this field" />
          </div>
          <input id="new-field-ai" name="aiDescription" type="text" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this field means, in plain words" />
        </div>
      </div>
      <p className="note">The key is made from the name and never changes afterward. Type and tracking can&apos;t be changed once the field exists.</p>
      {generateError ? <p className="form-error" role="alert">{generateError}</p> : null}
      <Feedback state={state} />
      <div className="button-row modal-actions">
        {onCancel ? <button type="button" className="btn btn-ghost btn-small" disabled={pending} onClick={onCancel}>Cancel</button> : null}
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>{pending ? 'Adding…' : 'Add Field'}</button>
      </div>
    </form>
  )
}

export function AddScreenForm({ action = addScreen }: { action?: FormAction }) {
  const [state, formAction, pending] = useActionState(action, initialState)
  const formRef = useResetOnDone(state.done)
  return (
    <form action={formAction} ref={formRef}>
      <div className="form-row">
        <div className="field">
          <label htmlFor="new-screen-name">Screen Name</label>
          <input id="new-screen-name" name="name" type="text" required maxLength={60} placeholder="Leasing" />
        </div>
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>{pending ? 'Adding…' : 'Add Screen'}</button>
      </div>
      <Feedback state={state} />
    </form>
  )
}

export function AddSectionForm({ levels, screens, action = addSection }: { levels: LevelOption[]; screens: LevelOption[]; action?: FormAction }) {
  const [state, formAction, pending] = useActionState(action, initialState)
  const formRef = useResetOnDone(state.done)
  return (
    <form action={formAction} ref={formRef}>
      <div className="form-row">
        <div className="field">
          <label htmlFor="new-section-name">Section or List Name</label>
          <input id="new-section-name" name="name" type="text" required maxLength={60} placeholder="Capital Projects" />
        </div>
        <div className="field">
          <label htmlFor="new-section-kind">Shown As</label>
          <select id="new-section-kind" name="kind" defaultValue="form">
            <option value="form">Form (Fields)</option>
            <option value="tiles">Tiles (Fields)</option>
            <option value="list">List (Rows)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-section-screen">Screen</label>
          <select id="new-section-screen" name="screenId" defaultValue={screens[0]?.value}>
            {screens.map((screen) => (
              <option key={screen.value} value={screen.value}>{screen.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-section-level">Belongs To</label>
          <select id="new-section-level" name="appliesTo" defaultValue={levels[0]?.value}>
            {levels.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>{pending ? 'Adding…' : 'Add Section'}</button>
      </div>
      <Feedback state={state} />
    </form>
  )
}
