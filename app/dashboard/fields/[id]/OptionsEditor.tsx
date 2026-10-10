'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ActionResult } from '../actions'

export type EditableOption = { key: string; label: string; parent: string | null; countsAs: string | null; retired: boolean }
type Choice = { key: string; label: string }
type Row = EditableOption & { id: string; isNew: boolean }
export type OptionsSaved = { ok: true; message: string; options: EditableOption[] } | { ok: false; error: string }
type SaveOptions = (input: { fieldId: string; options: { key: string | null; label: string; parent: string | null; countsAs: string | null; retired: boolean }[] }) => Promise<OptionsSaved>
type ResetOptions = (input: { fieldId: string; setting: string | null }) => Promise<ActionResult>

const ALL = '__all'
const NONE = '__none'

function when(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : ` ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

/**
 * The choices of a pick list: add, rename, reorder, retire and remove them.
 * Saved on its own, apart from the field's other settings.
 *
 * - `parent` is set for a field whose choices depend on another field
 *   (Property Subtype on Property Type): each choice then says which choice
 *   of that field it belongs to.
 * - `standardKeys` is set when an organization edits its own version of a
 *   Stratios standard list: a choice it adds can say which standard choice it
 *   counts as.
 */
export function OptionsEditor({
  fieldId,
  fieldName,
  options,
  parent,
  standardChoices,
  modifiedAt,
  isModified,
  saveAction,
  resetAction,
}: {
  fieldId: string
  fieldName: string
  options: EditableOption[]
  parent: { name: string; choices: Choice[] } | null
  standardChoices: Choice[] | null
  isModified: boolean
  modifiedAt: string | null
  saveAction: SaveOptions
  resetAction?: ResetOptions
}) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>(() => options.map((option) => ({ ...option, id: option.key, isNew: false })))
  const [group, setGroup] = useState(ALL)
  const [added, setAdded] = useState(0)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, start] = useTransition()
  const standardKeys = useMemo(() => new Set((standardChoices ?? []).map((choice) => choice.key)), [standardChoices])

  const shown = rows.filter((row) => group === ALL || (group === NONE ? row.parent === null : row.parent === group))
  const change = (id: string, patch: Partial<Row>) => {
    setMessage(null)
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }
  const remove = (id: string) => {
    setMessage(null)
    setRows((current) => current.filter((row) => row.id !== id))
  }
  // Moves a row past its neighbor in the list as shown, so it also works with a group picked.
  const move = (id: string, by: -1 | 1) => {
    setMessage(null)
    setRows((current) => {
      const visible = current.filter((row) => group === ALL || (group === NONE ? row.parent === null : row.parent === group))
      const at = visible.findIndex((row) => row.id === id)
      const other = visible[at + by]
      if (at < 0 || !other) return current
      const next = [...current]
      const from = next.findIndex((row) => row.id === id)
      const to = next.findIndex((row) => row.id === other.id)
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
  }
  const add = () => {
    setMessage(null)
    setAdded((count) => count + 1)
    setRows((current) => [...current, { id: `new-${added + 1}`, isNew: true, key: '', label: '', parent: group !== ALL && group !== NONE ? group : null, countsAs: null, retired: false }])
  }

  const save = () => {
    setMessage(null)
    start(async () => {
      const result = await saveAction({
        fieldId,
        options: rows.map((row) => ({ key: row.isNew ? null : row.key, label: row.label, parent: row.parent, countsAs: row.countsAs, retired: row.retired })),
      })
      if (!result.ok) {
        setMessage({ text: result.error, error: true })
        return
      }
      // Show the list as saved: new options now have their permanent keys, and any kept as retired are back.
      setRows(result.options.map((option) => ({ ...option, id: option.key, isNew: false })))
      setMessage({ text: result.message, error: false })
      router.refresh()
    })
  }
  const reset = () => {
    if (!resetAction) return
    setMessage(null)
    start(async () => {
      const result = await resetAction({ fieldId, setting: 'options' })
      if (!result.ok) {
        setMessage({ text: result.error, error: true })
        return
      }
      window.location.reload()
    })
  }

  return (
    <div className="stack options-editor">
      {isModified ? (
        <span className="modified-note">
          <span className="chip chip-modified">Modified{when(modifiedAt)}</span>
          <span>Your organization has its own version of this list, so it no longer follows Stratios updates to it.</span>
          {resetAction ? <button type="button" className="link-button" disabled={busy} onClick={reset}>Reset to Standard</button> : null}
        </span>
      ) : null}

      {parent ? (
        <div className="field field-narrow">
          <label htmlFor="oe-group">Show Options For</label>
          <select id="oe-group" value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value={ALL}>Every {parent.name}</option>
            {parent.choices.map((choice) => (
              <option key={choice.key} value={choice.key}>{choice.label}</option>
            ))}
            <option value={NONE}>Options for Any {parent.name}</option>
          </select>
        </div>
      ) : null}

      <div className="table-scroll">
        <table className="options-table">
          <thead>
            <tr>
              <th scope="col">Option</th>
              {parent ? <th scope="col">Belongs To</th> : null}
              {standardChoices ? <th scope="col">Counts As</th> : null}
              <th scope="col">Retired</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={5} className="note">No options here yet.</td></tr>
            ) : null}
            {shown.map((row, index) => {
              const custom = standardChoices !== null && (row.isNew || !standardKeys.has(row.key))
              return (
                <tr key={row.id} className={row.retired ? 'option-retired' : undefined}>
                  <td>
                    <input type="text" aria-label="Option name" value={row.label} maxLength={100} onChange={(event) => change(row.id, { label: event.target.value })} placeholder="Name of the option" />
                  </td>
                  {parent ? (
                    <td>
                      <select aria-label={`${parent.name} this option belongs to`} value={row.parent ?? ''} onChange={(event) => change(row.id, { parent: event.target.value || null })}>
                        <option value="">Any {parent.name}</option>
                        {parent.choices.map((choice) => (
                          <option key={choice.key} value={choice.key}>{choice.label}</option>
                        ))}
                      </select>
                    </td>
                  ) : null}
                  {standardChoices ? (
                    <td>
                      {custom ? (
                        <select aria-label="Standard option this one counts as" value={row.countsAs ?? ''} onChange={(event) => change(row.id, { countsAs: event.target.value || null })}>
                          <option value="">Nothing Standard</option>
                          {standardChoices.map((choice) => (
                            <option key={choice.key} value={choice.key}>{choice.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="note">Standard</span>
                      )}
                    </td>
                  ) : null}
                  <td>
                    <input type="checkbox" aria-label={`Retire ${row.label || 'this option'}`} checked={row.retired} onChange={(event) => change(row.id, { retired: event.target.checked })} />
                  </td>
                  <td className="option-actions">
                    <button type="button" className="link-button" disabled={busy || index === 0} onClick={() => move(row.id, -1)}>Up</button>
                    <button type="button" className="link-button" disabled={busy || index === shown.length - 1} onClick={() => move(row.id, 1)}>Down</button>
                    <button type="button" className="link-button danger" disabled={busy} onClick={() => remove(row.id)}>Remove</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="button-row">
        <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={add}>Add Option</button>
        <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save Options'}</button>
      </div>
      {message ? <p className={message.error ? 'form-error' : 'form-ok'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
      <p className="note">
        Renaming an option keeps every record that holds it; the records simply show the new name. A retired option is no longer offered for {fieldName} but stays on the records that
        have it. Removing an option that records still hold retires it instead.
        {parent ? ` Each option is offered only when ${parent.name} is the one it belongs to.` : ''}
        {standardChoices ? ' An option you add can count as a standard one, so features that follow the standard list still recognize it.' : ''}
      </p>
    </div>
  )
}
