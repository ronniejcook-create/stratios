// Browser only. Draws pages of a PDF as pictures and adds them to an asset's
// photos. Floor plans, stacking plans and maps are usually drawings inside
// the PDF rather than pictures that can be copied out, so the page itself is
// drawn, the way a PDF viewer shows it, and saved as a JPEG.
//
// The drawing is done by PDF.js, served as plain files from /pdfjs (see
// public/pdfjs/README.txt) and loaded only when first needed.

type PdfPage = {
  getViewport(options: { scale: number }): { width: number; height: number }
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas: HTMLCanvasElement }): { promise: Promise<void> }
  cleanup(): void
}
type PdfDocument = { numPages: number; getPage(page: number): Promise<PdfPage> }
type PdfTask = { promise: Promise<PdfDocument>; destroy?: () => Promise<void> }
type PdfLibrary = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument(options: { data: Uint8Array; standardFontDataUrl: string; wasmUrl: string }): PdfTask
}

/** The long side of a page picture, in pixels: sharp enough to read a floor plan's suite numbers. */
const LONG_SIDE = 2000
export const MAX_PAGES_AT_ONCE = 20

let loading: Promise<PdfLibrary> | null = null

/**
 * Loads PDF.js once. It is brought in with a small module script rather than
 * an import, so it stays out of the app's own bundle and loads from /pdfjs as is.
 */
function loadLibrary(): Promise<PdfLibrary> {
  if (loading) return loading
  loading = new Promise<PdfLibrary>((resolve, reject) => {
    const holder = window as unknown as { __stratiosPdf?: PdfLibrary }
    if (holder.__stratiosPdf) return resolve(holder.__stratiosPdf)
    const done = () => {
      window.removeEventListener('stratios-pdf-ready', done)
      if (holder.__stratiosPdf) resolve(holder.__stratiosPdf)
      else reject(new Error('The PDF tool did not load'))
    }
    window.addEventListener('stratios-pdf-ready', done)
    const script = document.createElement('script')
    script.type = 'module'
    script.textContent = `import * as lib from '/pdfjs/pdf.min.js'; lib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js'; window.__stratiosPdf = lib; window.dispatchEvent(new Event('stratios-pdf-ready'))`
    script.onerror = () => reject(new Error('The PDF tool did not load'))
    document.head.appendChild(script)
    window.setTimeout(() => reject(new Error('The PDF tool took too long to load')), 30000)
  })
  loading.catch(() => {
    loading = null // let a later attempt try again
  })
  return loading
}

export type PageRequest = { page: number; caption: string | null }
export type PagesResult = { added: number; problems: string[] }

/**
 * Draws the given pages of one of the asset's documents and adds each to the
 * asset's photos under Plan or Map. A page already added is left as it is.
 * Never throws; anything that went wrong is described in `problems`.
 */
export async function addDocumentPages(
  assetId: string,
  documentId: string,
  pages: PageRequest[],
  onProgress?: (done: number, total: number) => void,
): Promise<PagesResult> {
  const wanted = pages.filter((entry) => Number.isInteger(entry.page) && entry.page > 0).slice(0, MAX_PAGES_AT_ONCE)
  if (wanted.length === 0) return { added: 0, problems: [] }
  let document_: PdfDocument
  let task: PdfTask | null = null
  try {
    const [library, response] = await Promise.all([loadLibrary(), fetch(`/api/documents/${documentId}/file`)])
    if (!response.ok) return { added: 0, problems: [response.status === 404 ? 'The document could not be opened. You may not have permission to open it.' : 'The document could not be opened.'] }
    const data = new Uint8Array(await response.arrayBuffer())
    task = library.getDocument({ data, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' })
    document_ = await task.promise
  } catch (error) {
    console.error('Opening a document to draw its pages failed', error)
    return { added: 0, problems: ['The document could not be opened to draw its pages.'] }
  }

  const problems: string[] = []
  let added = 0
  for (let index = 0; index < wanted.length; index += 1) {
    const { page, caption } = wanted[index]
    onProgress?.(index, wanted.length)
    if (page > document_.numPages) {
      problems.push(`Page ${page} does not exist; the document has ${document_.numPages} pages.`)
      continue
    }
    try {
      const pdfPage = await document_.getPage(page)
      const base = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: LONG_SIDE / Math.max(base.width, base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('No drawing surface')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await pdfPage.render({ canvasContext: context, viewport, canvas }).promise
      pdfPage.cleanup()
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
      if (!blob) throw new Error('The page could not be saved as a picture')

      const query = new URLSearchParams({ assetId, documentId, page: String(page), width: String(canvas.width), height: String(canvas.height) })
      if (caption) query.set('caption', caption)
      const response = await fetch(`/api/photos?${query}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob })
      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (result?.ok) added += 1
      else problems.push(`Page ${page}: ${result?.error ?? 'the picture could not be saved.'}`)
    } catch (error) {
      console.error(`Drawing page ${page} failed`, error)
      problems.push(`Page ${page} could not be drawn.`)
    }
  }
  onProgress?.(wanted.length, wanted.length)
  // Frees the memory the document was using; nothing depends on it succeeding.
  try {
    await task?.destroy?.()
  } catch {
    // already closed
  }
  return { added, problems }
}

/** Reads "18, 19, 28-30" into page numbers, in order, without repeats. Null when the text isn't a list of pages. */
export function parsePages(text: string): number[] | null {
  const pages: number[] = []
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const match = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(part)
    if (!match) return null
    const first = Number(match[1])
    const last = match[2] ? Number(match[2]) : first
    if (first < 1 || last < first || last - first > 50) return null
    for (let page = first; page <= last; page += 1) if (!pages.includes(page)) pages.push(page)
  }
  return pages
}
