'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AiIcon } from '@/components/AiIcon'
import { decideValue, deleteDocument, settleProposedField, type ActionResult } from '../actions'
import { readUploadedDocument } from '../requests'

/** Runs one action, shows its error or message, and reloads the list when it works. */
function useAction() {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const run = (work: () => Promise<ActionResult>, after?: () => void) => {
    setNote(null)
    start(async () => {
      const result = await work()
      if (!result.ok) {
        setNote({ text: result.error, error: true })
        return
      }
      if (result.message) setNote({ text: result.message, error: false })
      if (after) after()
      else router.refresh()
    })
  }
  return { busy, note, run }
}

function Note({ note }: { note: { text: string; error: boolean } | null }) {
  if (!note) return null
  return <span className={note.error ? 'form-error' : 'form-ok'} role={note.error ? 'alert' : 'status'}>{note.text}</span>
}

/** The two choices for a value that is waiting for a person. */
export function DecisionButtons({ findingId, keepLabel }: { findingId: string; keepLabel: string }) {
  const { busy, note, run } = useAction()
  return (
    <span className="review-actions">
      <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => run(() => decideValue({ findingId, accept: true }))}>Use Document&apos;s Value</button>
      <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => run(() => decideValue({ findingId, accept: false }))}>{keepLabel}</button>
      <Note note={note} />
    </span>
  )
}

/** Add or dismiss a field the agent proposed. */
export function ProposalButtons({ proposalId }: { proposalId: string }) {
  const { busy, note, run } = useAction()
  return (
    <span className="review-actions">
      <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => run(() => settleProposedField({ proposalId, add: true }))}>Add Field</button>
      <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => run(() => settleProposedField({ proposalId, add: false }))}>Dismiss</button>
      <Note note={note} />
    </span>
  )
}

/** Has the agent read a document that hasn't been read, or whose reading failed. */
export function ReadButton({ documentId, label }: { documentId: string; label: string }) {
  const router = useRouter()
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const read = async () => {
    setError(null)
    setReading(true)
    const result = await readUploadedDocument(documentId)
    setReading(false)
    if (!result.ok) setError(result.error)
    router.refresh()
  }
  return (
    <div className="doc-progress">
      {reading ? (
        <>
          <span className="doc-reading" role="status"><AiIcon /> Reading the document. This can take a few minutes; keep this page open.</span>
          <span className="doc-bar doc-bar-busy"><span /></span>
        </>
      ) : (
        <button type="button" className="btn btn-primary btn-small" onClick={() => void read()}>{label}</button>
      )}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  )
}

/** Removes the document, asking first. */
export function RemoveButton({ documentId, backHref }: { documentId: string; backHref: string }) {
  const router = useRouter()
  const { busy, note, run } = useAction()
  const [confirming, setConfirming] = useState(false)
  if (!confirming) return <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirming(true)}>Remove Document</button>
  return (
    <span className="review-actions">
      <button type="button" className="btn btn-ghost btn-small danger" disabled={busy} onClick={() => run(() => deleteDocument({ documentId }), () => router.push(backHref))}>Confirm Remove</button>
      <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
      <span className="note">The file and this list are removed. Values already filled in stay.</span>
      <Note note={note} />
    </span>
  )
}
