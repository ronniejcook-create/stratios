'use client'

import { createContext, useCallback, useContext, useMemo, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AiIcon } from '@/components/AiIcon'
import { decideValue, deleteDocument, settleProposedField, type ActionResult } from '../actions'
import { readUploadedDocument } from '@/lib/documentClient'

type Notice = { text: string; error: boolean }
type Notices = { notes: Record<string, string>; setNote: (area: string, text: string | null) => void }

const NoticeContext = createContext<Notices>({ notes: {}, setNote: () => {} })

/**
 * Holds the "it worked" message for each part of the review list. A row leaves
 * its table as soon as its choice is saved, so a message shown on the row
 * would vanish with it; the message is shown at the top of the section instead.
 */
export function ReviewNotices({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const setNote = useCallback((area: string, text: string | null) => {
    setNotes((current) => {
      const next = { ...current }
      if (text) next[area] = text
      else delete next[area]
      return next
    })
  }, [])
  const value = useMemo(() => ({ notes, setNote }), [notes, setNote])
  return <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>
}

/**
 * One part of the review list. It stays on the page after its last row has
 * been dealt with for as long as it has a message to show.
 */
export function ReviewSection({ area, title, empty, children }: { area: string; title: string; empty: boolean; children: ReactNode }) {
  const { notes, setNote } = useContext(NoticeContext)
  const text = notes[area]
  if (empty && !text) return null
  return (
    <section className="panel">
      <h2>{title}</h2>
      {text ? (
        <p className="review-notice" role="status">
          <span>{text}</span>
          <button type="button" className="review-notice-close" aria-label="Dismiss message" onClick={() => setNote(area, null)}>×</button>
        </p>
      ) : null}
      {empty ? <p className="note">Nothing else is waiting here.</p> : children}
    </section>
  )
}

/** Runs one action, shows its error or message, and reloads the list when it works. */
function useAction(area?: string) {
  const { setNote: setSectionNote } = useContext(NoticeContext)
  const router = useRouter()
  const [busy, start] = useTransition()
  const [note, setNote] = useState<Notice | null>(null)
  const run = (work: () => Promise<ActionResult>, after?: () => void) => {
    setNote(null)
    if (area) setSectionNote(area, null)
    start(async () => {
      const result = await work()
      if (!result.ok) {
        setNote({ text: result.error, error: true })
        return
      }
      if (result.message) {
        if (area) setSectionNote(area, result.message)
        else setNote({ text: result.message, error: false })
      }
      if (after) after()
      else router.refresh()
    })
  }
  return { busy, note, run }
}

function Note({ note }: { note: Notice | null }) {
  if (!note) return null
  return <span className={note.error ? 'form-error' : 'form-ok'} role={note.error ? 'alert' : 'status'}>{note.text}</span>
}

/** The two choices for a value that is waiting for a person. */
export function DecisionButtons({ findingId, keepLabel }: { findingId: string; keepLabel: string }) {
  const { busy, note, run } = useAction('decisions')
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
  const { busy, note, run } = useAction('proposals')
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
