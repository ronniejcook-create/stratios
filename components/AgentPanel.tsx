'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { askAgent, CANNOT_UPLOAD, canUpload, DOCUMENT_ACCEPT, loadCashFlow, recalculateKpis, uploadDocument, type AgentLink, type AgentPages, type AgentStatement } from '@/lib/documentClient'
import { addDocumentPages } from '@/lib/pagePictures'
import { toHtml } from '@/lib/richText'
import { useAgentReferences } from './AgentContext'
import { AiIcon } from './AiIcon'

type Attachment = { id: string; name: string }
type Message = { role: 'user' | 'assistant'; text: string; attachments?: Attachment[]; links?: AgentLink[]; choices?: string[]; failed?: boolean }
/** A file dropped into the panel: uploading, ready to send, or refused. */
type Pending = { key: number; name: string; progress: number; id: string | null; error: string | null }

const MAX_MB = 20
const SUGGESTIONS = ['Create an asset from this Offering Memorandum', 'Which assets do we have?', 'What is the purchase price of this asset?']

/**
 * The AI agents column: a chat with the Portfolio Analyst. Files can be
 * dropped anywhere on it; they upload straight away and go with the next
 * message. The conversation lives in the browser until the page is reloaded.
 */
export function AgentPanel() {
  const router = useRouter()
  const pathname = usePathname()
  const { references, removeReference, clearReferences } = useAgentReferences()
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [working, setWorking] = useState(false)
  const [planStatus, setPlanStatus] = useState<string | null>(null)
  const [kpiStatus, setKpiStatus] = useState<string | null>(null)
  const [statementStatus, setStatementStatus] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const nextKey = useRef(1)

  const pageAssetId = pathname?.match(/^\/dashboard\/assets\/([0-9a-f-]{36})/i)?.[1] ?? null
  const uploading = pending.some((file) => file.id === null && file.error === null)
  const ready = pending.filter((file) => file.id !== null)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages, working, pending.length])

  const addFiles = (files: File[]) => {
    for (const file of files) {
      const key = nextKey.current++
      const refuse = (error: string) => setPending((current) => [...current, { key, name: file.name, progress: 0, id: null, error }])
      if (!canUpload(file)) {
        refuse(CANNOT_UPLOAD)
        continue
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        refuse(`Too large. The limit is ${MAX_MB} MB.`)
        continue
      }
      setPending((current) => [...current, { key, name: file.name, progress: 0, id: null, error: null }])
      const update = (change: Partial<Pending>) => setPending((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)))
      void uploadDocument(null, file, (progress) => update({ progress })).then((result) => update(result.ok ? { id: result.id, progress: 1 } : { error: result.error }))
    }
  }

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    addFiles(Array.from(event.dataTransfer.files ?? []))
  }

  /** Sends what is typed, or `chosen` when the person clicked one of the analyst's answer buttons. */
  const send = async (chosen?: string) => {
    const text = (chosen ?? draft).trim()
    if (working || uploading || (!text && ready.length === 0)) return
    const attachments = ready.map((file) => ({ id: file.id as string, name: file.name }))
    const mine: Message = { role: 'user', text: text || (attachments.length === 1 ? 'Here is a document.' : 'Here are some documents.'), attachments }
    const history = [...messages, mine]
    setMessages(history)
    if (chosen === undefined) setDraft('')
    setPending([])
    setWorking(true)
    const answer = await askAgent({
      turns: history.filter((message) => !message.failed).map((message) => ({ role: message.role, text: message.text, attachments: message.attachments })),
      pageAssetId,
      references: references.map((item) => item.reference),
    })
    setWorking(false)
    if (!answer.ok) {
      setMessages((current) => [...current, { role: 'assistant', text: answer.error, failed: true }])
      return
    }
    setMessages((current) => [...current, { role: 'assistant', text: answer.text, links: answer.links, choices: answer.choices }])
    if (answer.changed) router.refresh()
    if (answer.pages && answer.pages.length > 0) void addPlanPages(answer.pages)
    if (answer.kpis && answer.kpis.length > 0) void calculateKpis(answer.kpis)
    if (answer.statements && answer.statements.length > 0) void copyStatements(answer.statements)
  }

  // An operating statement is copied line by line as a cash flow after the
  // reply, on its own like the KPIs, so the person can keep chatting. If it
  // fails, Load From a Document on the asset's Cash Flow tab does the same.
  const copyStatements = async (jobs: AgentStatement[]) => {
    setStatementStatus('Copying the operating statement line by line…')
    const said: string[] = []
    for (const job of jobs) {
      const result = await loadCashFlow(job.documentId)
      said.push(result.ok ? `Cash flow: ${result.message}` : `The cash flow was not saved: ${result.error}`)
    }
    setStatementStatus(said.join(' '))
    router.refresh()
  }

  // After a rent roll is read, the property's KPIs are calculated from the
  // new leases. Like the plan pages it runs on its own after the reply, so
  // the person can keep chatting; if it fails, Recalculate KPIs on the
  // asset's Leases tab does the same.
  const calculateKpis = async (assetIds: string[]) => {
    setKpiStatus('Calculating KPIs from the leases…')
    const said: string[] = []
    for (const assetId of assetIds) {
      const result = await recalculateKpis(assetId)
      said.push(result.ok ? `KPIs: ${result.message}` : `The KPIs were not calculated: ${result.error}`)
    }
    setKpiStatus(said.join(' '))
    router.refresh()
  }

  // Plan and map pages are drawn as pictures here in the browser, after the
  // agent has answered, and added to the asset's photos. It runs on its own:
  // the person can keep chatting, and a failure only means those pages are
  // missing (they can be added from the asset's Photos tab).
  const addPlanPages = async (jobs: AgentPages[]) => {
    const total = jobs.reduce((sum, job) => sum + job.pages.length, 0)
    setPlanStatus(total === 1 ? 'Adding 1 plan or map page to the photos…' : `Adding ${total} plan and map pages to the photos…`)
    let added = 0
    for (const job of jobs) added += (await addDocumentPages(job.assetId, job.documentId, job.pages)).added
    setPlanStatus(added === 0 ? null : added === 1 ? '1 plan or map page was added to the photos.' : `${added} plan and map pages were added to the photos.`)
    if (added > 0) router.refresh()
  }

  const hasAttachment = ready.length > 0 || uploading

  return (
    <div
      className={`agent-panel${dragging ? ' agent-dragging' : ''}`}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={drop}
    >
      <div className="agent-picker">
        <AiIcon />
        <span>Portfolio Analyst</span>
        {messages.length > 0 ? (
          <button type="button" className="link-button agent-new" disabled={working} onClick={() => setMessages([])}>New Chat</button>
        ) : null}
      </div>

      <div className="agent-thread" aria-live="polite">
        {messages.length === 0 ? (
          <div className="agent-empty">
            <p className="agent-empty-title">Ask, or Drop a Document</p>
            <p>Ask about your assets, or drop a PDF or Excel file here and tell the analyst what to do with it, such as creating an asset from an Offering Memorandum or loading a rent roll.</p>
            <ul>
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button type="button" onClick={() => setDraft(suggestion)}>“{suggestion}”</button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((message, index) => (
            <div key={index} className={`agent-message agent-${message.role}${message.failed ? ' agent-failed' : ''}`}>
              {message.attachments?.map((file) => (
                <span key={file.id} className="agent-file">{file.name}</span>
              ))}
              {message.role === 'assistant' && !message.failed ? (
                // toHtml escapes every piece of text, so the reply can only become plain formatting.
                <div className="agent-text" dangerouslySetInnerHTML={{ __html: toHtml(message.text) }} />
              ) : (
                <div className="agent-text">{message.text}</div>
              )}
              {message.links && message.links.length > 0 ? (
                <div className="agent-links">
                  {message.links.map((link) => (
                    <Link key={link.href} href={link.href} className="btn btn-ghost btn-small">{link.label}</Link>
                  ))}
                </div>
              ) : null}
              {/* Answers to the analyst's question, as buttons. Only the latest reply's can be clicked; older ones are gone. */}
              {message.choices && message.choices.length > 0 && index === messages.length - 1 && !working ? (
                <div className="agent-choices" role="group" aria-label="Answers">
                  {message.choices.map((choice, place) => (
                    <button key={choice} type="button" className={`btn btn-small ${place === 0 ? 'btn-primary' : 'btn-ghost'}`} disabled={uploading} onClick={() => void send(choice)}>{choice}</button>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
        {working ? (
          <div className="agent-message agent-assistant agent-working" role="status">
            <span className="agent-dots" aria-hidden="true"><span /><span /><span /></span>
            <span>{hasAttachmentIn(messages) ? 'Working. Reading a document can take a few minutes; keep this page open.' : 'Working…'}</span>
          </div>
        ) : null}
        {planStatus ? <p className="agent-status" role="status">{planStatus}</p> : null}
        {kpiStatus ? <p className="agent-status" role="status">{kpiStatus}</p> : null}
        {statementStatus ? <p className="agent-status" role="status">{statementStatus}</p> : null}
        <div ref={end} />
      </div>

      {references.length > 0 ? (
        <div className="agent-refs">
          <div className="agent-refs-head">
            <span>Referenced Fields</span>
            <button type="button" className="link-button" onClick={clearReferences}>Clear All</button>
          </div>
          <ul>
            {references.map((item) => (
              <li key={item.reference}>
                <div className="agent-ref-text">
                  <span className="agent-ref-label">{item.label}</span>
                  {item.detail ? <span className="agent-ref-detail">{item.detail}</span> : null}
                  <code>{item.reference}</code>
                </div>
                <button type="button" className="icon-button" aria-label={`Remove ${item.label}`} onClick={() => removeReference(item.reference)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form
        className="agent-composer"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        {pending.length > 0 ? (
          <ul className="agent-pending">
            {pending.map((file) => (
              <li key={file.key} className={file.error ? 'agent-pending-error' : undefined}>
                <span className="agent-pending-name">{file.name}</span>
                <span className="agent-pending-state">{file.error ?? (file.id ? 'Ready' : `Uploading ${Math.round(file.progress * 100)}%`)}</span>
                <button type="button" className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => setPending((current) => current.filter((item) => item.key !== file.key))}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          maxLength={8000}
          placeholder={hasAttachment ? 'Say what to do with it…' : 'Message the analyst, or drop a PDF or Excel file…'}
          aria-label="Message the analyst"
        />
        <div className="agent-composer-row">
          <input
            ref={fileInput}
            type="file"
            accept={DOCUMENT_ACCEPT}
            multiple
            className="sr-only"
            aria-label="Attach a PDF or Excel file"
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <button type="button" className="icon-button" title="Attach a PDF or Excel File" aria-label="Attach a PDF or Excel file" onClick={() => fileInput.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.5 8.5a1.8 1.8 0 01-2.6-2.6l7.8-7.8" />
            </svg>
          </button>
          <button type="submit" className="agent-send" disabled={working || uploading || (!draft.trim() && ready.length === 0)} title="Send" aria-label="Send">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </form>
      {dragging ? <div className="agent-drop" aria-hidden="true">Drop the file to attach it</div> : null}
    </div>
  )
}

/** True when the latest message carries a document, so the wait is explained. */
function hasAttachmentIn(messages: Message[]): boolean {
  const last = messages[messages.length - 1]
  return Boolean(last?.attachments && last.attachments.length > 0)
}
