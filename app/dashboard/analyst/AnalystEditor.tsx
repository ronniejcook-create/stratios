'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RichTextEditor } from '@/components/RichTextEditor'
import { resetInstructions, saveInstructions, type ActionResult } from './actions'

/** The box where Stratios administrators write how the analyst works and writes. */
export function AnalystEditor({ instructions, builtIn, custom }: { instructions: string; builtIn: string; custom: boolean }) {
  const router = useRouter()
  const [text, setText] = useState(instructions)
  const [reading, setReading] = useState(true)
  // Changing this number rebuilds the Reading View from the text (it loads its text only once).
  const [version, setVersion] = useState(0)
  const [confirmReset, setConfirmReset] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, startBusy] = useTransition()
  const changed = text.trim() !== instructions.trim()

  const run = (work: () => Promise<ActionResult>, after?: () => void) => {
    setMessage(null)
    startBusy(async () => {
      const result = await work()
      if (!result.ok) {
        setMessage({ text: result.error, error: true })
        return
      }
      setMessage({ text: result.message, error: false })
      after?.()
      router.refresh()
    })
  }

  return (
    <form
      className="stack field-editor"
      onSubmit={(event) => {
        event.preventDefault()
        run(() => saveInstructions({ instructions: text }))
      }}
    >
      <div className="field">
        <div className="label-row">
          <label id="analyst-label" htmlFor="analyst-instructions">Instructions</label>
          <div className="view-toggle" role="group" aria-label="How to show the instructions">
            <button type="button" aria-pressed={reading} onClick={() => setReading(true)}>Reading View</button>
            <button type="button" aria-pressed={!reading} onClick={() => setReading(false)}>Markdown</button>
          </div>
        </div>
        {reading ? (
          <RichTextEditor key={version} value={text} onChange={setText} labelledBy="analyst-label" placeholder="Write how the analyst should work and write." />
        ) : (
          <textarea id="analyst-instructions" className="instructions-box" rows={18} value={text} onChange={(event) => setText(event.target.value)} maxLength={20000} spellCheck />
        )}
      </div>

      <div className="button-row">
        <button type="submit" className="btn btn-primary btn-small" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save Changes'}</button>
        {changed ? (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={busy}
            onClick={() => {
              setText(instructions)
              setVersion((current) => current + 1)
              setMessage(null)
            }}
          >
            Undo Changes
          </button>
        ) : null}
        {custom && !confirmReset ? <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirmReset(true)}>Reset to Default</button> : null}
        {confirmReset ? (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-small danger"
              disabled={busy}
              onClick={() =>
                run(resetInstructions, () => {
                  setText(builtIn)
                  setVersion((current) => current + 1)
                  setConfirmReset(false)
                })
              }
            >
              Confirm Reset
            </button>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirmReset(false)}>Cancel</button>
          </>
        ) : null}
      </div>
      {confirmReset ? <p className="note">Resetting replaces what is written here with the instructions built into Stratios.</p> : null}
      {message ? <p className={message.error ? 'form-error' : 'form-ok'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
    </form>
  )
}
