'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CANNOT_UPLOAD, canUpload as isUploadable, DOCUMENT_ACCEPT, readLeaseDocument, uploadDocument } from '@/lib/documentClient'

export type LeaseDocumentRow = {
  id: string
  name: string
  status: 'uploaded' | 'reading' | 'read' | 'failed'
  /** "Lease Agreement", "First Amendment" and the like, as the agent named it. */
  documentType: string | null
  error: string | null
  uploaded: string
  /** What the reading did, in a few words. */
  found: string
  undecided: number
}

type Progress = { stage: 'uploading' | 'reading'; name: string; done: number } | null

/**
 * The documents loaded onto one lease: the lease agreement, its amendments,
 * a commencement letter, a guaranty. Each is read by the agent into the
 * lease's fields; a later document replaces the terms it changes.
 */
export function LeaseDocuments({ leaseId, assetId, documents, maxMb }: { leaseId: string; assetId: string; documents: LeaseDocumentRow[]; maxMb: number }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<Progress>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean; reviewId?: string } | null>(null)
  const busy = progress !== null

  const read = async (id: string, name: string) => {
    setMessage(null)
    setProgress({ stage: 'reading', name, done: 1 })
    const result = await readLeaseDocument(leaseId, id)
    setProgress(null)
    if (!result.ok) {
      setMessage({ text: result.error, error: true })
      router.refresh()
      return
    }
    const parts = [
      result.filled + result.replaced > 0 ? `${result.filled + result.replaced} ${result.filled + result.replaced === 1 ? 'field was' : 'fields were'} filled in` : '',
      result.decisions > 0 ? `${result.decisions} ${result.decisions === 1 ? 'needs' : 'need'} your decision` : '',
      result.listRows > 0 ? `${result.listRows} critical ${result.listRows === 1 ? 'date was' : 'dates were'} added to the property` : '',
    ].filter(Boolean)
    setMessage({ text: parts.length > 0 ? `${parts.join('; ')}.` : 'The document was read, but nothing in it fit the lease fields.', error: false, reviewId: id })
    router.refresh()
  }

  const upload = async (file: File) => {
    setMessage(null)
    if (file.size > maxMb * 1024 * 1024) {
      setMessage({ text: `That file is too large. The limit is ${maxMb} MB.`, error: true })
      return
    }
    if (!isUploadable(file)) {
      setMessage({ text: CANNOT_UPLOAD, error: true })
      return
    }
    setProgress({ stage: 'uploading', name: file.name, done: 0 })
    const uploaded = await uploadDocument(assetId, file, (done) => setProgress({ stage: 'uploading', name: file.name, done }))
    if (!uploaded.ok) {
      setProgress(null)
      setMessage({ text: uploaded.error, error: true })
      return
    }
    await read(uploaded.id, file.name)
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Lease Documents</h2>
        <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => input.current?.click()}>Load Lease Document</button>
        <input
          ref={input}
          type="file"
          accept={DOCUMENT_ACCEPT}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file)
          }}
        />
      </div>
      <p className="note">
        Load the lease agreement, then each amendment, commencement letter or guaranty, oldest first. The agent reads each one into the fields below, following the Reading a
        Lease skill; a later document replaces the terms it changes, as the Which Source Wins skill says.
      </p>
      {progress ? (
        <p className="note" role="status">
          {progress.stage === 'uploading' ? `Uploading ${progress.name}… ${Math.round(progress.done * 100)}%` : `Reading ${progress.name}. A long lease takes a few minutes; you can leave this page open.`}
        </p>
      ) : null}
      {message ? (
        <p className={message.error ? 'form-error' : 'form-ok'} role={message.error ? 'alert' : 'status'}>
          {message.text}{' '}
          {message.reviewId ? <Link href={`/dashboard/assets/${assetId}/documents/${message.reviewId}`}>Review What Was Found</Link> : null}
        </p>
      ) : null}

      {documents.length === 0 ? (
        <p className="note" role="status">No documents have been loaded onto this lease yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="lease-table kpi-table">
            <thead>
              <tr><th scope="col">Document</th><th scope="col">Kind</th><th scope="col">Loaded</th><th scope="col">Result</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <th scope="row">{document.name}</th>
                  <td>{document.documentType ?? ''}</td>
                  <td>{document.uploaded}</td>
                  <td>
                    {document.status === 'read' ? document.found || 'Read' : document.status === 'failed' ? <span className="form-error">{document.error ?? 'The reading failed.'}</span> : document.status === 'reading' ? 'Being read…' : 'Not read yet'}
                    {document.undecided > 0 ? <span className="kpi-kept">{document.undecided} {document.undecided === 1 ? 'value needs' : 'values need'} your decision.</span> : null}
                  </td>
                  <td>
                    {document.status === 'read' ? (
                      <Link href={`/dashboard/assets/${assetId}/documents/${document.id}`}>Review</Link>
                    ) : document.status === 'reading' ? null : (
                      <button type="button" className="link-button" disabled={busy} onClick={() => read(document.id, document.name)}>{document.status === 'failed' ? 'Try Again' : 'Read'}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
