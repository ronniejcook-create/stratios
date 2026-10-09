'use client'

import { useRef, useState, useTransition, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/DataGrid'
import { addDocumentPages, MAX_PAGES_AT_ONCE, parsePages } from '@/lib/pagePictures'
import { deletePhoto, makeMainPhoto, pullPhotosFromDocuments, savePhotoDetails } from './actions'

export type PhotoRow = {
  id: string
  category: string
  categoryLabel: string
  caption: string | null
  isMain: boolean
  /** "From <file>, page 3", or "Uploaded". */
  source: string
}

export type CategoryOption = { value: string; label: string }

/** A document on the asset whose pages can be added as pictures. */
export type PageSource = {
  id: string
  name: string
  /** Pages the agent marked as plans or maps that are not among the photos yet. */
  suggested: { page: number; caption: string | null }[]
}

/** Photos are shrunk to this many pixels on the long side before they are sent. */
const MAX_SIDE = 2000
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

/** Shrinks a picture in the browser and re-saves it as a JPEG, so uploads stay small whatever the camera produced. */
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    // A white backing, because JPEG has no transparency.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    return blob ? { blob, width, height } : null
  } catch {
    return null
  }
}

/**
 * The Photos tab of an asset: the photos pulled from documents and uploaded
 * by people, with a main photo, captions and removal for people who can edit.
 */
export function PhotosPanel({
  assetId,
  photos,
  canEdit,
  categories,
  documentCount,
  pageSources,
  problem,
}: {
  assetId: string
  photos: PhotoRow[]
  canEdit: boolean
  categories: CategoryOption[]
  /** How many documents the asset has, for offering to pull their photos. */
  documentCount: number
  /** The asset's documents, for people who may open them; empty for everyone else. */
  pageSources: PageSource[]
  /** Set when the photos could not be loaded, for example before the database update. */
  problem: string | null
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState('')
  const [dragging, setDragging] = useState(false)
  const [viewing, setViewing] = useState<PhotoRow | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [category, setCategory] = useState('other')
  const [busy, start] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  const upload = async (files: File[]) => {
    setError(null)
    const pictures = files.filter((file) => ACCEPTED.includes(file.type))
    if (pictures.length === 0) {
      setError('Photos must be JPEG, PNG or WebP pictures.')
      return
    }
    const problems: string[] = []
    for (let index = 0; index < pictures.length; index += 1) {
      const file = pictures[index]
      setUploading(pictures.length > 1 ? `Adding photo ${index + 1} of ${pictures.length}…` : 'Adding the photo…')
      const small = await shrink(file)
      if (!small) {
        problems.push(`${file.name} could not be read as a picture.`)
        continue
      }
      try {
        const query = new URLSearchParams({ assetId, name: file.name, width: String(small.width), height: String(small.height) })
        const response = await fetch(`/api/photos?${query}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: small.blob })
        const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null
        if (!result?.ok) problems.push(`${file.name}: ${result?.error ?? 'The photo could not be saved.'}`)
      } catch {
        problems.push(`${file.name} could not be sent. Check your connection and try again.`)
      }
    }
    setUploading(null)
    if (problems.length > 0) setError(problems.join(' '))
    router.refresh()
  }

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (canEdit && !uploading) void upload([...event.dataTransfer.files])
  }

  const act = (work: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: () => void) => {
    setError(null)
    start(async () => {
      const result = await work()
      if (!result.ok) {
        setError(result.error)
        return
      }
      done?.()
      router.refresh()
    })
  }

  // Add Pages from a Document: which document, which pages, and how far along it is.
  const [pagesOpen, setPagesOpen] = useState(false)
  const [sourceId, setSourceId] = useState('')
  const [pageText, setPageText] = useState('')
  const [pagesError, setPagesError] = useState<string | null>(null)
  const [drawing, setDrawing] = useState<string | null>(null)
  const source = pageSources.find((candidate) => candidate.id === sourceId)
  const suggestedCount = pageSources.reduce((sum, candidate) => sum + candidate.suggested.length, 0)

  const choose = (id: string) => {
    setSourceId(id)
    setPageText((pageSources.find((candidate) => candidate.id === id)?.suggested ?? []).map((entry) => entry.page).join(', '))
    setPagesError(null)
  }
  const openPages = () => {
    setError(null)
    setMessage(null)
    // Start on the document with pages waiting, if there is one.
    choose((pageSources.find((candidate) => candidate.suggested.length > 0) ?? pageSources[0])?.id ?? '')
    setPagesOpen(true)
  }
  const addPages = async () => {
    if (!source) return
    const pages = parsePages(pageText)
    if (!pages || pages.length === 0) {
      setPagesError('Enter page numbers separated by commas, for example 18, 19, 28-30.')
      return
    }
    if (pages.length > MAX_PAGES_AT_ONCE) {
      setPagesError(`Add up to ${MAX_PAGES_AT_ONCE} pages at a time.`)
      return
    }
    setPagesError(null)
    setDrawing('Opening the document…')
    const captions = new Map(source.suggested.map((entry) => [entry.page, entry.caption]))
    const result = await addDocumentPages(
      assetId,
      source.id,
      pages.map((page) => ({ page, caption: captions.get(page) ?? null })),
      (done, total) => setDrawing(done < total ? `Adding page ${done + 1} of ${total}…` : 'Finishing…'),
    )
    setDrawing(null)
    if (result.added > 0) router.refresh()
    if (result.problems.length > 0) {
      setPagesError(`${result.added > 0 ? `${result.added === 1 ? '1 page was' : `${result.added} pages were`} added. ` : ''}${result.problems.join(' ')}`)
      return
    }
    setMessage(result.added === 1 ? '1 page was added under Plan or Map.' : `${result.added} pages were added under Plan or Map.`)
    setPagesOpen(false)
  }

  const pull = () => {
    setError(null)
    setMessage(null)
    start(async () => {
      const result = await pullPhotosFromDocuments({ assetId })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setMessage(result.added === 0 ? 'No new photos were found in this asset\'s documents.' : result.added === 1 ? '1 photo was added.' : `${result.added} photos were added.`)
      router.refresh()
    })
  }

  if (problem) {
    return (
      <div className="panel notice">
        <h2>Photos</h2>
        <p>{problem}</p>
      </div>
    )
  }

  const inUse = categories.filter((option) => photos.some((photo) => photo.category === option.value))
  const shown = show ? photos.filter((photo) => photo.category === show) : photos

  return (
    <div
      className={`panel photo-panel${dragging ? ' dragging' : ''}`}
      onDragOver={(event) => {
        if (!canEdit) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <h2>Photos</h2>
      <p className="note">
        Photos are pulled from a document when the agent reads it, and can be added by hand. The main photo stands for the asset in the Assets list.
      </p>

      <div className="doc-upload">
        {canEdit ? (
          <>
            <input
              ref={input}
              type="file"
              accept={ACCEPTED.join(',')}
              multiple
              hidden
              onChange={(event) => {
                const files = [...(event.target.files ?? [])]
                event.target.value = ''
                if (files.length > 0) void upload(files)
              }}
            />
            <button type="button" className="btn btn-primary btn-small" disabled={uploading !== null} onClick={() => input.current?.click()}>Add Photos</button>
            {documentCount > 0 ? (
              <button type="button" className="btn btn-ghost btn-small" disabled={busy || uploading !== null} onClick={pull} title="Copies the photographs out of the documents already on this asset">
                {busy ? 'Working…' : 'Get Photos from Documents'}
              </button>
            ) : null}
            {pageSources.length > 0 ? (
              <button type="button" className="btn btn-ghost btn-small" disabled={busy || uploading !== null} onClick={openPages} title="Adds whole pages of a document, such as floor plans and maps, as pictures">
                Add Pages from a Document{suggestedCount > 0 ? ` (${suggestedCount})` : ''}
              </button>
            ) : null}
            <span className="note">{uploading ?? 'Or drag pictures onto this panel. JPEG, PNG or WebP.'}</span>
          </>
        ) : null}
        {inUse.length > 1 ? (
          <select className="photo-filter" aria-label="Show photos by what they show" value={show} onChange={(event) => setShow(event.target.value)}>
            <option value="">Show: All ({photos.length})</option>
            {inUse.map((option) => (
              <option key={option.value} value={option.value}>{option.label} ({photos.filter((photo) => photo.category === option.value).length})</option>
            ))}
          </select>
        ) : null}
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-ok" role="status">{message}</p> : null}

      {photos.length === 0 ? (
        <p className="empty">{canEdit ? 'No photos yet. Add some, or have the agent read an offering memorandum.' : 'No photos yet.'}</p>
      ) : (
        <ul className="photo-grid">
          {shown.map((photo) => (
            <li key={photo.id} className={`photo-card${photo.isMain ? ' main' : ''}`}>
              <button type="button" className="photo-open" onClick={() => setViewing(photo)} title="View larger">
                {/* Served by our own route to signed-in members only, so the plain img element is the right tool here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/photos/${photo.id}`} alt={photo.caption ?? photo.categoryLabel} loading="lazy" />
              </button>
              {editing === photo.id ? (
                <div className="photo-edit">
                  <input type="text" aria-label="Caption" maxLength={300} placeholder="Caption" value={caption} onChange={(event) => setCaption(event.target.value)} />
                  <select aria-label="What the photo shows" value={category} onChange={(event) => setCategory(event.target.value)}>
                    {categories.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <span className="review-actions">
                    <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => act(() => savePhotoDetails({ photoId: photo.id, caption, category }), () => setEditing(null))}>Save</button>
                    <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                  </span>
                </div>
              ) : (
                <div className="photo-info">
                  <div className="photo-tags">
                    {photo.isMain ? <span className="chip chip-modified">Main Photo</span> : null}
                    <span className="chip">{photo.categoryLabel}</span>
                  </div>
                  {photo.caption ? <p className="photo-caption">{photo.caption}</p> : null}
                  <p className="doc-sub">{photo.source}</p>
                  {canEdit ? (
                    removing === photo.id ? (
                      <span className="review-actions">
                        <button type="button" className="btn btn-ghost btn-small danger" disabled={busy} onClick={() => act(() => deletePhoto({ photoId: photo.id }), () => setRemoving(null))}>Confirm Remove</button>
                        <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setRemoving(null)}>Cancel</button>
                      </span>
                    ) : (
                      <span className="photo-actions">
                        {photo.isMain ? null : <button type="button" className="link-button" disabled={busy} onClick={() => act(() => makeMainPhoto({ photoId: photo.id }))}>Set as Main</button>}
                        <button
                          type="button"
                          className="link-button"
                          disabled={busy}
                          onClick={() => {
                            setCaption(photo.caption ?? '')
                            setCategory(photo.category)
                            setRemoving(null)
                            setEditing(photo.id)
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="link-button danger" disabled={busy} onClick={() => { setEditing(null); setRemoving(photo.id) }}>Remove</button>
                      </span>
                    )
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={pagesOpen} title="Add Pages from a Document" onClose={() => { if (!drawing) setPagesOpen(false) }}>
        <p className="modal-text">
          Floor plans, stacking plans and maps are usually drawings, so they can&apos;t be copied out like photos. This adds the whole page as a picture, under Plan or Map.
        </p>
        <div className="form-row">
          <div className="field">
            <label htmlFor="pages-document">Document</label>
            <select id="pages-document" value={sourceId} disabled={drawing !== null} onChange={(event) => choose(event.target.value)}>
              {pageSources.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pages-list">Pages</label>
            <input id="pages-list" type="text" inputMode="numeric" placeholder="18, 19, 28-30" value={pageText} disabled={drawing !== null} onChange={(event) => setPageText(event.target.value)} />
          </div>
        </div>
        <p className="note">
          {source && source.suggested.length > 0
            ? `The agent marked ${source.suggested.length === 1 ? 'this page' : 'these pages'} as plans or maps. Change the list if you want different pages.`
            : 'Enter the page numbers as the PDF viewer counts them, starting at 1.'}
        </p>
        {pagesError ? <p className="form-error" role="alert">{pagesError}</p> : null}
        {drawing ? <p className="form-ok" role="status">{drawing} Keep this page open.</p> : null}
        <div className="button-row modal-actions">
          <button type="button" className="btn btn-ghost btn-small" disabled={drawing !== null} onClick={() => setPagesOpen(false)}>Cancel</button>
          <button type="button" className="btn btn-primary btn-small" disabled={drawing !== null || !source} onClick={() => void addPages()}>{drawing ? 'Adding…' : 'Add Pages'}</button>
        </div>
      </Modal>

      <Modal open={viewing !== null} title={viewing?.caption ?? viewing?.categoryLabel ?? 'Photo'} onClose={() => setViewing(null)} wide>
        {viewing ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="photo-large" src={`/api/photos/${viewing.id}`} alt={viewing.caption ?? viewing.categoryLabel} />
            <p className="doc-sub">{viewing.categoryLabel} · {viewing.source}</p>
          </>
        ) : null}
      </Modal>
    </div>
  )
}
