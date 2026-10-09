'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RichTextEditor } from '@/components/RichTextEditor'
import type { SkillActionResult, SkillInput } from '@/lib/skills'

export type EditableSkill = { id: string; name: string; useWhen: string; instructions: string; enabled: boolean }

type Actions = {
  add: (input: SkillInput) => Promise<SkillActionResult>
  save: (input: SkillInput & { id: string }) => Promise<SkillActionResult>
  /** Left out when the skill can't be removed here (a Stratios standard skill seen by an organization). */
  remove?: (input: { id: string }) => Promise<SkillActionResult>
  /** Given only for a standard skill the organization has changed. */
  reset?: (input: { id: string }) => Promise<SkillActionResult>
}

const EXAMPLE = `### What This Document Is
One or two lines on what it is and how far to trust it.

### Rules
- Where to look for each kind of value.
- What to prefer when the document gives two figures.
- What never to fill in from this kind of document.

### What to Mention in the Summary
- Anything the reviewer should know.`

/**
 * Adds a skill (no `skill` given) or edits one. A skill is its name, a line
 * saying when to use it, and its instructions. The same editor serves an
 * organization's Skills screen and the Stratios Skills Library; each passes
 * its own actions and the address of its list (`basePath`).
 */
export function SkillEditor({ skill, actions, basePath, removeNote }: { skill?: EditableSkill; actions: Actions; basePath: string; removeNote?: string }) {
  const router = useRouter()
  const [name, setName] = useState(skill?.name ?? '')
  const [useWhen, setUseWhen] = useState(skill?.useWhen ?? '')
  const [instructions, setInstructions] = useState(skill?.instructions ?? '')
  const [enabled, setEnabled] = useState(skill?.enabled ?? true)
  const [reading, setReading] = useState(true)
  const [confirm, setConfirm] = useState<'remove' | 'reset' | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, startBusy] = useTransition()

  const run = (work: () => Promise<SkillActionResult>, after: (result: SkillActionResult & { ok: true }) => void) => {
    setMessage(null)
    startBusy(async () => {
      const result = await work()
      if (!result.ok) {
        setMessage({ text: result.error, error: true })
        return
      }
      setMessage({ text: result.message, error: false })
      after(result)
    })
  }

  /** Stays on this skill, or moves to the skill that now stands in its place. */
  const show = (result: { id?: string }) => {
    if (result.id && result.id !== skill?.id) router.push(`${basePath}/${result.id}`)
    else router.refresh()
  }

  const save = () => {
    const input = { name, useWhen, instructions, enabled }
    if (skill) run(() => actions.save({ id: skill.id, ...input }), show)
    else run(() => actions.add(input), (result) => router.push(result.id ? `${basePath}/${result.id}` : basePath))
  }

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
          <label htmlFor="skill-name">Name</label>
          <input id="skill-name" type="text" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder="Reading a Rent Roll" />
        </div>
        {skill ? (
          <div className="field field-narrow">
            <label htmlFor="skill-enabled">Status</label>
            <select id="skill-enabled" value={enabled ? 'on' : 'off'} onChange={(event) => setEnabled(event.target.value === 'on')}>
              <option value="on">In Use</option>
              <option value="off">Turned Off</option>
            </select>
          </div>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="skill-when">Use When</label>
        <textarea id="skill-when" rows={2} value={useWhen} onChange={(event) => setUseWhen(event.target.value)} maxLength={400} required placeholder="The document is a rent roll." />
        <p className="note">One or two sentences. This is how an agent decides whether the skill applies, so describe the document or the task plainly.</p>
      </div>
      <div className="field">
        <div className="label-row">
          <label id="skill-instructions-label" htmlFor="skill-instructions">Instructions</label>
          <div className="view-toggle" role="group" aria-label="How to show the instructions">
            <button type="button" aria-pressed={reading} onClick={() => setReading(true)}>Reading View</button>
            <button type="button" aria-pressed={!reading} onClick={() => setReading(false)}>Markdown</button>
          </div>
        </div>
        {reading ? (
          <RichTextEditor value={instructions} onChange={setInstructions} labelledBy="skill-instructions-label" placeholder="Write what the agent should do, in plain words. Use the buttons above for headings and bullets." />
        ) : (
          <textarea id="skill-instructions" className="instructions-box" rows={18} value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={20000} spellCheck placeholder={EXAMPLE} />
        )}
      </div>

      <div className="button-row">
        <button type="submit" className="btn btn-primary btn-small" disabled={busy}>{busy ? 'Saving…' : skill ? 'Save Changes' : 'Add Skill'}</button>
        {skill && actions.reset && confirm === null ? <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirm('reset')}>Reset to Standard</button> : null}
        {skill && actions.remove && confirm === null ? <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirm('remove')}>Remove Skill</button> : null}
        {skill && confirm === 'reset' && actions.reset ? (
          <button type="button" className="btn btn-ghost btn-small danger" disabled={busy} onClick={() => run(() => actions.reset!({ id: skill.id }), show)}>Confirm Reset</button>
        ) : null}
        {skill && confirm === 'remove' && actions.remove ? (
          <button type="button" className="btn btn-ghost btn-small danger" disabled={busy} onClick={() => run(() => actions.remove!({ id: skill.id }), () => router.push(basePath))}>Confirm Remove</button>
        ) : null}
        {confirm !== null ? <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button> : null}
      </div>
      {confirm === 'reset' ? <p className="note">Resetting discards your organization&apos;s version and goes back to the Stratios standard skill.</p> : null}
      {confirm === 'remove' ? <p className="note">{removeNote ?? 'Removing deletes the skill. To stop using it without deleting it, set its status to Turned Off.'}</p> : null}
      {message ? <p className={message.error ? 'form-error' : 'form-ok'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
    </form>
  )
}
