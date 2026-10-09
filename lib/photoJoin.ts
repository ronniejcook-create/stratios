// Brochures often run one wide photograph across two facing pages. Inside the
// PDF that is two separate pictures, a left half and a right half. This finds
// those pairs among the photos copied out of a document and joins each pair
// back into one picture.
//
// A pair is recognized by its seam: the right edge of the picture on one page
// and the left edge of the picture on the next page are nearly the same strip
// of pixels when they are two halves of one photograph, and unrelated
// otherwise. On the Knoll Trail memorandum real pairs scored under 6 and
// unrelated neighbors over 27, on a scale where 0 is identical.

import { createHash } from 'node:crypto'
import type { ExtractedPhoto } from './photoExtraction'

const SEAM_ROWS = 64
/** Edges closer than this are one photograph continuing across the fold. */
const MAX_SEAM_DIFFERENCE = 10
/** Two blank edges (plain white or one flat color) match without meaning anything, so an edge needs this much variation. */
const MIN_EDGE_VARIATION = 6
const MAX_HEIGHT_MISMATCH = 0.03

type Sharp = typeof import('sharp').default

/** One column of pixels at the left or right edge of a picture, squeezed to a fixed number of rows of red, green and blue. */
async function edgeStrip(sharp: Sharp, photo: ExtractedPhoto, side: 'left' | 'right'): Promise<Buffer> {
  return sharp(photo.data)
    .extract({ left: side === 'left' ? 0 : photo.width - 3, top: 0, width: 3, height: photo.height })
    .resize(1, SEAM_ROWS, { fit: 'fill' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer()
}

function difference(a: Buffer, b: Buffer): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY
  let total = 0
  for (let index = 0; index < a.length; index += 1) total += Math.abs(a[index] - b[index])
  return total / a.length
}

/** How much a strip changes from top to bottom; near zero for a blank edge. */
function variation(strip: Buffer): number {
  let total = 0
  for (let index = 3; index < strip.length; index += 1) total += Math.abs(strip[index] - strip[index - 3])
  return strip.length > 3 ? total / (strip.length - 3) : 0
}

const fingerprint = (data: Buffer) => createHash('sha256').update(data).digest('hex')

/**
 * Returns the photos with every two-page photograph joined into one picture.
 * A joined photo sits on its left page, lists both pages in `pages`, and
 * names the two pictures it replaces in `replaces` (their fingerprints), so
 * halves saved by an earlier reading can be swapped for it.
 *
 * Never throws. If the image tool is missing or a picture can't be decoded,
 * the photos come back as they were, in halves.
 */
export async function joinSpreads(photos: ExtractedPhoto[]): Promise<ExtractedPhoto[]> {
  if (photos.length < 2) return photos
  let sharp: Sharp
  try {
    const loaded = (await import('sharp')) as unknown as { default?: Sharp }
    // Depending on how the tool is packaged, the function is the module itself or its default.
    sharp = loaded.default ?? (loaded as unknown as Sharp)
  } catch (error) {
    console.error('The image tool is not available, so two-page photos were not joined', error)
    return photos
  }

  // Only the biggest picture on a page can be half of a spread.
  const biggest = new Map<number, ExtractedPhoto>()
  for (const photo of photos) {
    const current = biggest.get(photo.page)
    if (!current || photo.width * photo.height > current.width * current.height) biggest.set(photo.page, photo)
  }

  // Score every pair of neighboring pages, then take the best matches first so no picture is used twice.
  const candidates: { left: ExtractedPhoto; right: ExtractedPhoto; score: number }[] = []
  for (const left of biggest.values()) {
    const right = biggest.get(left.page + 1)
    if (!right) continue
    if (Math.abs(left.height - right.height) > Math.max(left.height, right.height) * MAX_HEIGHT_MISMATCH) continue
    try {
      const [a, b] = await Promise.all([edgeStrip(sharp, left, 'right'), edgeStrip(sharp, right, 'left')])
      const score = difference(a, b)
      if (score <= MAX_SEAM_DIFFERENCE && variation(a) >= MIN_EDGE_VARIATION && variation(b) >= MIN_EDGE_VARIATION) candidates.push({ left, right, score })
    } catch (error) {
      console.error(`Comparing the photos on pages ${left.page} and ${right.page} failed`, error)
    }
  }
  candidates.sort((a, b) => a.score - b.score)

  const joined = new Map<ExtractedPhoto, ExtractedPhoto>() // left half -> the joined picture
  const usedUp = new Set<ExtractedPhoto>()
  for (const { left, right } of candidates) {
    if (usedUp.has(left) || usedUp.has(right)) continue
    try {
      const height = Math.min(left.height, right.height)
      const fit = async (photo: ExtractedPhoto) => {
        const width = Math.round((photo.width * height) / photo.height)
        return { width, data: await sharp(photo.data).resize(width, height, { fit: 'fill' }).toBuffer() }
      }
      const [first, second] = await Promise.all([fit(left), fit(right)])
      const data = await sharp({ create: { width: first.width + second.width, height, channels: 3, background: '#ffffff' } })
        .composite([{ input: first.data, left: 0, top: 0 }, { input: second.data, left: first.width, top: 0 }])
        .jpeg({ quality: 90, mozjpeg: false })
        .toBuffer()
      joined.set(left, {
        page: left.page,
        pages: [left.page, right.page],
        width: first.width + second.width,
        height,
        data,
        replaces: [fingerprint(left.data), fingerprint(right.data)],
      })
      usedUp.add(left)
      usedUp.add(right)
    } catch (error) {
      console.error(`Joining the photos on pages ${left.page} and ${right.page} failed`, error)
    }
  }

  if (joined.size === 0) return photos
  return photos.flatMap((photo) => (joined.has(photo) ? [joined.get(photo)!] : usedUp.has(photo) ? [] : [photo]))
}
