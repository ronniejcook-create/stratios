// Pulls the photographs out of a PDF. Most brochures and offering memorandums
// keep each photo as a separate JPEG inside the file; those are copied out
// exactly as stored, with no re-compression. Logos, icons and map tiles are
// left behind by size, and a page that is one flattened design yields nothing
// useful, which is expected.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib'

export type ExtractedPhoto = { page: number; width: number; height: number; data: Buffer }

export const PHOTO_LIMITS = {
  /** Smaller than this is a logo, icon or thumbnail, not a photo worth keeping. */
  minWidth: 600,
  minHeight: 400,
  /** Banners and strips: wider or taller than this many times the other side. */
  maxAspect: 3,
  maxBytes: 4 * 1024 * 1024,
  /** Per document, in page order. */
  maxPhotos: 40,
}

const name = (text: string) => PDFName.of(text)
const numberOf = (dict: PDFDict, key: string): number => {
  const value = dict.lookup(name(key))
  return value instanceof PDFNumber ? value.asNumber() : 0
}

/** Browsers show four-ink (print) JPEGs with wrong colors, so those are skipped. */
function isPrintColor(dict: PDFDict): boolean {
  const space = dict.lookup(name('ColorSpace'))
  if (space === name('DeviceCMYK')) return true
  if (space instanceof PDFArray && space.size() > 1 && space.lookup(0) === name('ICCBased')) {
    const profile = space.lookup(1)
    if (profile instanceof PDFRawStream) return numberOf(profile.dict, 'N') === 4
  }
  return false
}

/**
 * The photos in a PDF, in page order. Never throws: a file that can't be
 * opened, or is password-protected, simply has no photos.
 */
export async function extractPhotos(file: Buffer): Promise<ExtractedPhoto[]> {
  let document: PDFDocument
  try {
    document = await PDFDocument.load(file, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })
  } catch (error) {
    console.error('Opening a PDF to look for photos failed', error)
    return []
  }
  // In a protected file the pictures are scrambled, so there is nothing usable to copy out.
  if (document.isEncrypted) return []

  const photos: ExtractedPhoto[] = []
  const seen = new Set<string>()
  const pages = document.getPages()
  for (let index = 0; index < pages.length && photos.length < PHOTO_LIMITS.maxPhotos; index += 1) {
    try {
      const objects = pages[index].node.Resources()?.lookupMaybe(name('XObject'), PDFDict)
      if (!objects) continue
      for (const [key, reference] of objects.entries()) {
        if (photos.length >= PHOTO_LIMITS.maxPhotos) break
        const stream = document.context.lookup(reference)
        if (!(stream instanceof PDFRawStream)) continue
        const dict = stream.dict
        if (dict.lookup(name('Subtype')) !== name('Image')) continue
        // Only pictures stored as plain JPEG can be copied out as they are.
        let filter = dict.lookup(name('Filter'))
        if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.lookup(0) : undefined
        if (filter !== name('DCTDecode')) continue

        // The same picture can be placed on several pages; keep its first appearance.
        const id = reference instanceof PDFRef ? reference.toString() : `${index}:${key.toString()}`
        if (seen.has(id)) continue
        seen.add(id)

        const width = numberOf(dict, 'Width')
        const height = numberOf(dict, 'Height')
        if (width < PHOTO_LIMITS.minWidth || height < PHOTO_LIMITS.minHeight) continue
        if (width > height * PHOTO_LIMITS.maxAspect || height > width * PHOTO_LIMITS.maxAspect) continue
        if (isPrintColor(dict)) continue
        const data = Buffer.from(stream.contents)
        if (data.length === 0 || data.length > PHOTO_LIMITS.maxBytes) continue
        // A real JPEG starts with these two bytes.
        if (data[0] !== 0xff || data[1] !== 0xd8) continue
        photos.push({ page: index + 1, width, height, data })
      }
    } catch (error) {
      console.error(`Looking for photos on page ${index + 1} failed`, error)
    }
  }
  return photos
}
