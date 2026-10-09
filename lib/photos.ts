// Photos on an asset: saving, listing, choosing the main one. The picture
// bytes live in asset_photos.data and are only read by getPhotoFile.

import { createHash } from 'node:crypto'
import type { ExtractedPhoto } from './photoExtraction'
import type { Queryable } from './records'

export const PHOTO_CATEGORIES = ['exterior', 'interior', 'aerial', 'area', 'plan', 'other'] as const
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number]
export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
  exterior: 'Exterior',
  interior: 'Interior',
  aerial: 'Aerial',
  area: 'Surrounding Area',
  plan: 'Plan or Map',
  other: 'Other',
}
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
/** Uploaded photos are shrunk in the browser first, so this is generous. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024
export const MAX_PHOTOS_PER_ASSET = 200

export type Photo = {
  id: string
  assetId: string
  documentId: string | null
  documentName: string | null
  page: number | null
  fileName: string | null
  category: PhotoCategory
  caption: string | null
  isMain: boolean
  width: number | null
  height: number | null
}

/** What the agent said about the photos on a page of a document. */
export type PhotoNote = { page: number; category: PhotoCategory; caption: string | null }

export const isPhotoCategory = (value: unknown): value is PhotoCategory => (PHOTO_CATEGORIES as readonly string[]).includes(String(value))

const fingerprint = (data: Buffer) => createHash('sha256').update(data).digest('hex')

export async function listPhotos(client: Queryable, orgId: string, assetId: string): Promise<Photo[]> {
  const { rows } = await client.query(
    `select p.id::text as id, p.asset_id::text as asset_id, p.document_id::text as document_id, d.name as document_name,
            p.page, p.file_name, p.category, p.caption, p.is_main, p.width, p.height
     from asset_photos p left join documents d on d.id = p.document_id
     where p.org_id = $1 and p.asset_id = $2
     order by p.is_main desc, p.sort_order, p.created_at, p.id`,
    [orgId, assetId],
  )
  return rows.map((row) => ({
    id: row.id,
    assetId: row.asset_id,
    documentId: row.document_id,
    documentName: row.document_name,
    page: row.page,
    fileName: row.file_name,
    category: row.category,
    caption: row.caption,
    isMain: row.is_main,
    width: row.width,
    height: row.height,
  }))
}

/** Each asset's main photo, for the Assets list: asset id -> photo id. */
export async function listMainPhotos(client: Queryable, orgId: string): Promise<Map<string, string>> {
  const { rows } = await client.query('select asset_id::text as asset_id, id::text as id from asset_photos where org_id = $1 and is_main', [orgId])
  return new Map(rows.map((row) => [row.asset_id as string, row.id as string]))
}

/** The picture itself, for showing it. */
export async function getPhotoFile(client: Queryable, orgId: string, photoId: string): Promise<{ data: Buffer; contentType: string } | null> {
  const { rows } = await client.query('select data, content_type from asset_photos where org_id = $1 and id = $2', [orgId, photoId])
  return rows[0] ? { data: rows[0].data as Buffer, contentType: rows[0].content_type as string } : null
}

type NewPhoto = {
  data: Buffer
  contentType: string
  width: number | null
  height: number | null
  documentId: string | null
  page: number | null
  fileName: string | null
  category: PhotoCategory
  caption: string | null
  sortOrder: number
}

/** Adds one photo. Returns null when the asset already has this exact picture. */
async function insertPhoto(client: Queryable, orgId: string, userId: string, assetId: string, photo: NewPhoto): Promise<string | null> {
  const { rows } = await client.query(
    `insert into asset_photos (org_id, asset_id, document_id, page, file_name, category, caption, content_type, width, height, size_bytes, sha256, sort_order, data, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     on conflict (asset_id, sha256) do nothing
     returning id::text as id`,
    [orgId, assetId, photo.documentId, photo.page, photo.fileName, photo.category, photo.caption, photo.contentType, photo.width, photo.height,
      photo.data.length, fingerprint(photo.data), photo.sortOrder, photo.data, userId],
  )
  return rows[0]?.id ?? null
}

async function countPhotos(client: Queryable, orgId: string, assetId: string): Promise<number> {
  const { rows } = await client.query('select count(*)::int as n from asset_photos where org_id = $1 and asset_id = $2', [orgId, assetId])
  return Number(rows[0].n)
}

async function hasMain(client: Queryable, orgId: string, assetId: string): Promise<boolean> {
  const { rows } = await client.query('select 1 from asset_photos where org_id = $1 and asset_id = $2 and is_main', [orgId, assetId])
  return rows.length > 0
}

/**
 * Saves the photos pulled out of a document onto its asset, labeled with what
 * the agent said about each page. If the asset has no main photo yet, one is
 * chosen: the page the agent picked, else the first exterior, else the first
 * photo. Returns how many were added (photos the asset already has are skipped).
 */
export async function savePhotosFromDocument(
  client: Queryable,
  orgId: string,
  userId: string,
  input: { assetId: string; documentId: string; photos: ExtractedPhoto[]; notes: PhotoNote[]; mainPage: number | null },
): Promise<number> {
  const room = MAX_PHOTOS_PER_ASSET - (await countPhotos(client, orgId, input.assetId))
  // Several photos on one page take that page's notes in order; the last note covers any extra.
  const notesByPage = new Map<number, PhotoNote[]>()
  for (const note of input.notes) notesByPage.set(note.page, [...(notesByPage.get(note.page) ?? []), note])
  const used = new Map<number, number>()

  const added: { id: string; page: number; category: PhotoCategory }[] = []
  for (const photo of input.photos) {
    if (added.length >= room) break
    const notes = notesByPage.get(photo.page) ?? []
    const position = used.get(photo.page) ?? 0
    used.set(photo.page, position + 1)
    const note = notes[Math.min(position, notes.length - 1)]
    const id = await insertPhoto(client, orgId, userId, input.assetId, {
      data: photo.data,
      contentType: 'image/jpeg',
      width: photo.width,
      height: photo.height,
      documentId: input.documentId,
      page: photo.page,
      fileName: null,
      category: note?.category ?? 'other',
      caption: note?.caption ?? null,
      sortOrder: photo.page,
    })
    if (id) added.push({ id, page: photo.page, category: note?.category ?? 'other' })
  }

  if (added.length > 0 && !(await hasMain(client, orgId, input.assetId))) {
    const pick = added.find((photo) => photo.page === input.mainPage) ?? added.find((photo) => photo.category === 'exterior') ?? added[0]
    await client.query('update asset_photos set is_main = true where org_id = $1 and id = $2', [orgId, pick.id])
  }
  return added.length
}

/** A page of a document worth keeping as a picture (a floor plan, site plan or map), as the agent noted it. */
export type PlanPage = { page: number; caption: string | null }

/** How a page snapshot is told apart from a photo copied out of the file: its file name. */
const snapshotName = (page: number) => `Page ${page}`

/** Keeps the agent's notes on a document's photographs, for adding pages later. */
export async function saveDocumentPhotoNotes(client: Queryable, orgId: string, documentId: string, notes: PhotoNote[]): Promise<void> {
  await client.query('update documents set photo_notes = $3::jsonb where org_id = $1 and id = $2', [orgId, documentId, JSON.stringify(notes)])
}

/**
 * For each document on an asset, the pages the agent marked as plans or maps.
 * Read through to_jsonb so it still works where the photo_notes column has
 * not been added yet (migration 014): those documents simply have none.
 */
export async function listPlanPages(client: Queryable, orgId: string, assetId: string): Promise<Map<string, PlanPage[]>> {
  const { rows } = await client.query(
    `select d.id::text as id, to_jsonb(d) -> 'photo_notes' as notes from documents d where d.org_id = $1 and d.asset_id = $2`,
    [orgId, assetId],
  )
  const found = new Map<string, PlanPage[]>()
  for (const row of rows) found.set(row.id as string, planPagesOf(Array.isArray(row.notes) ? (row.notes as PhotoNote[]) : []))
  return found
}

/** The plan and map pages among the agent's notes: one entry per page, in page order, a dozen at most. */
export function planPagesOf(notes: PhotoNote[]): PlanPage[] {
  const pages = new Map<number, PlanPage>()
  for (const note of notes) {
    if (note?.category !== 'plan' || !Number.isInteger(note.page) || note.page < 1 || pages.has(note.page)) continue
    pages.set(note.page, { page: note.page, caption: note.caption ? String(note.caption).slice(0, 300) : null })
  }
  return [...pages.values()].sort((a, b) => a.page - b.page).slice(0, 12)
}

export type PhotoResult = { ok: true; id: string } | { ok: false; error: string }

/** Adds a photo a person uploaded. The first photo on an asset becomes its main photo. */
export async function addUploadedPhoto(
  client: Queryable,
  orgId: string,
  userId: string,
  input: {
    assetId: string
    data: Buffer
    contentType: string
    fileName: string | null
    width: number | null
    height: number | null
    /** Set when the picture is a snapshot of a page of one of the asset's documents. */
    snapshot?: { documentId: string; page: number; caption: string | null }
  },
): Promise<PhotoResult> {
  if (!(PHOTO_TYPES as readonly string[]).includes(input.contentType)) return { ok: false, error: 'Photos must be JPEG, PNG or WebP pictures.' }
  if (input.data.length === 0) return { ok: false, error: 'That photo is empty.' }
  if (input.data.length > MAX_PHOTO_BYTES) return { ok: false, error: 'That photo is too large.' }
  const snapshot = input.snapshot
  if (snapshot) {
    const document = await client.query('select 1 from documents where org_id = $1 and id = $2 and asset_id = $3', [orgId, snapshot.documentId, input.assetId])
    if (document.rows.length === 0) return { ok: false, error: 'That document does not belong to this asset.' }
    // Adding the same page twice changes nothing.
    const already = await client.query(
      'select id::text as id from asset_photos where org_id = $1 and asset_id = $2 and document_id = $3 and page = $4 and file_name = $5',
      [orgId, input.assetId, snapshot.documentId, snapshot.page, snapshotName(snapshot.page)],
    )
    if (already.rows[0]) return { ok: true, id: already.rows[0].id as string }
  }
  const existing = await countPhotos(client, orgId, input.assetId)
  if (existing >= MAX_PHOTOS_PER_ASSET) return { ok: false, error: `An asset can hold up to ${MAX_PHOTOS_PER_ASSET} photos. Remove some first.` }
  const id = await insertPhoto(client, orgId, userId, input.assetId, {
    data: input.data,
    contentType: input.contentType,
    width: input.width,
    height: input.height,
    documentId: snapshot?.documentId ?? null,
    page: snapshot?.page ?? null,
    fileName: snapshot ? snapshotName(snapshot.page) : input.fileName ? input.fileName.replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || null : null,
    category: snapshot ? 'plan' : 'other',
    caption: snapshot?.caption ? snapshot.caption.replace(/\s+/g, ' ').trim().slice(0, 300) || null : null,
    // Snapshots sit with their document's photos by page; uploads come after them all.
    sortOrder: snapshot ? snapshot.page : 100000,
  })
  if (!id) return { ok: false, error: 'This asset already has that photo.' }
  if (!(await hasMain(client, orgId, input.assetId))) await client.query('update asset_photos set is_main = true where org_id = $1 and id = $2', [orgId, id])
  return { ok: true, id }
}

/** Makes one photo the asset's main photo. False when the photo isn't this organization's. */
export async function setMainPhoto(client: Queryable, orgId: string, photoId: string): Promise<string | null> {
  const found = await client.query('select asset_id::text as asset_id from asset_photos where org_id = $1 and id = $2', [orgId, photoId])
  const assetId = found.rows[0]?.asset_id as string | undefined
  if (!assetId) return null
  await client.query('update asset_photos set is_main = false where org_id = $1 and asset_id = $2 and is_main', [orgId, assetId])
  await client.query('update asset_photos set is_main = true where org_id = $1 and id = $2', [orgId, photoId])
  return assetId
}

/** Changes a photo's caption and what it shows. Returns its asset, or null when the photo isn't this organization's. */
export async function updatePhoto(client: Queryable, orgId: string, photoId: string, input: { caption: string; category: PhotoCategory }): Promise<string | null> {
  const caption = input.caption.replace(/\s+/g, ' ').trim().slice(0, 300) || null
  const { rows } = await client.query(
    'update asset_photos set caption = $3, category = $4 where org_id = $1 and id = $2 returning asset_id::text as asset_id',
    [orgId, photoId, caption, input.category],
  )
  return rows[0]?.asset_id ?? null
}

/**
 * Removes a photo for good. If it was the main photo, the next one in order
 * takes its place. Returns its asset, or null when the photo isn't this organization's.
 */
export async function removePhoto(client: Queryable, orgId: string, photoId: string): Promise<string | null> {
  const { rows } = await client.query('delete from asset_photos where org_id = $1 and id = $2 returning asset_id::text as asset_id, is_main', [orgId, photoId])
  const removed = rows[0]
  if (!removed) return null
  if (removed.is_main) {
    await client.query(
      `update asset_photos set is_main = true
       where id = (select id from asset_photos where org_id = $1 and asset_id = $2
                   order by (category = 'exterior') desc, sort_order, created_at, id limit 1)`,
      [orgId, removed.asset_id],
    )
  }
  return removed.asset_id as string
}
