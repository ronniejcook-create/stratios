'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AiIcon } from '@/components/AiIcon'
import { CANNOT_UPLOAD, canUpload as isUploadable, DOCUMENT_ACCEPT, readUploadedDocument, recalculateKpis, uploadDocument } from '@/lib/documentClient'

export type DocumentRow = {
  id: string
  name: string
  size: string
  uploaded: string
  status: 'uploaded' | 'reading' | 'read' | 'failed'
  /** Reading started long enough ago that it must have stopped. */
  stalled: boolean
  error: string | null
  documentType: string | null
  /** One line on what the agent found, for a document that has been read. */
  found: string
  undecided: number
}

type Progress = { stage: 'uploading' | 'reading'; name: string; done: number } | null

/**
 * The Documents tab of an asset: upload a PDF, have the agent read it, and
 * open each document's review list.
 */
export function DocumentsPanel({ assetId, documents, canUpload, maxMb }: { assetId: string; documents: DocumentRow[]; canUpload: boolean; maxMb: number }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<Progress>(null)
  const [error, setError] = useState<string | null>(null)

  const read = async (id: string, name: string) => {
    setError(null)
    setProgress({ stage: 'reading', name, done: 1 })
    const result = await readUploadedDocument(id)
    setProgress(null)
    if (!result.ok) {
      setError(result.error)
      router.refresh()
      return
    }
    // A rent roll's leases are in place now; the KPIs are calculated from them in the background.
    if (result.rentRollRows > 0) void recalculateKpis(assetId).then((done) => (done.ok ? router.refresh() : undefined))
    router.push(`/dashboard/assets/${assetId}/documents/${id}`)
  }

  const upload = async (file: File) => {
    setError(null)
    if (file.size > maxMb * 1024 * 1024) {
      setError(`That file is too large. The limit is ${maxMb} MB.`)
      return
    }
    if (!isUploadable(file)) {
      setError(CANNOT_UPLOAD)
      return
    }
    setProgress({ stage: 'uploading', name: file.name, done: 0 })
    const uploaded = await uploadDocument(assetId, file, (done) => setProgress({ stage: 'uploading', name: file.name, done }))
    if (!uploaded.ok) {
      setProgress(null)
      setError(uploaded.error)
      return
    }
    router.refresh()
    await read(uploaded.id, file.name)
  }

  const busy = progress !== null

  return (
    <section className="panel">
      <h2>Documents</h2>
      <p className="note">
        Upload an Offering Memorandum, appraisal, rent roll, loan document or other PDF or Excel file. The agent reads it against your fields, fills in what your rules allow, and gives you a review list of
        everything it found.
      </p>

      {canUpload ? (
        <div className="doc-upload">
          <input
            ref={input}
            type="file"
            accept={DOCUMENT_ACCEPT}
            className="sr-only"
            aria-label="Choose a PDF or Excel file to upload"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void upload(file)
            }}
          />
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => input.current?.click()}>Upload Document</button>
          <span className="note">PDF (up to 100 pages) or Excel (.xlsx), up to {maxMb} MB.</span>
        </div>
      ) : (
        <p className="note">Your role can view documents&apos; findings but not add documents.</p>
      )}

      {progress ? (
        <div className="doc-progress" role="status">
          {progress.stage === 'uploading' ? (
            <>
              <span>Uploading {progress.name}… {Math.round(progress.done * 100)}%</span>
              <span className="doc-bar"><span style={{ width: `${Math.round(progress.done * 100)}%` }} /></span>
            </>
          ) : (
            <>
              <span className="doc-reading"><AiIcon /> Reading {progress.name}. This can take a few minutes; keep this page open.</span>
              <span className="doc-bar doc-bar-busy"><span /></span>
            </>
          )}
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {documents.length === 0 ? (
        <p className="empty">No documents yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Uploaded</th>
                <th>Status</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => {
                const href = `/dashboard/assets/${assetId}/documents/${document.id}`
                const waiting = document.status === 'uploaded' || document.status === 'failed' || document.stalled
                return (
                  <tr key={document.id}>
                    <td>
                      <Link href={href}>{document.name}</Link>
                      <div className="doc-sub">{[document.documentType, document.size].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>{document.uploaded}</td>
                    <td>
                      {document.status === 'read' ? (
                        <>
                          <span className={`chip${document.undecided > 0 ? ' chip-modified' : ''}`}>
                            {document.undecided > 0 ? `${document.undecided} to Decide` : 'Reviewed'}
                          </span>
                          <div className="doc-sub">{document.found}</div>
                        </>
                      ) : document.status === 'reading' && !document.stalled ? (
                        <span className="chip">Reading…</span>
                      ) : document.status === 'failed' ? (
                        <>
                          <span className="chip chip-failed">Could Not Be Read</span>
                          {document.error ? <div className="doc-sub">{document.error}</div> : null}
                        </>
                      ) : (
                        <span className="chip">Not Read Yet</span>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                      {waiting && canUpload ? (
                        <button type="button" className="link-button" disabled={busy} onClick={() => void read(document.id, document.name)}>
                          {document.status === 'failed' || document.stalled ? 'Try Again' : 'Read Document'}
                        </button>
                      ) : null}
                      {document.status === 'read' ? <Link href={href}>Review</Link> : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
