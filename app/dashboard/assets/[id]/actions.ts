'use server'

import { revalidatePath } from 'next/cache'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { PROPERTY_TYPES, deleteAsset } from '@/lib/assets'
import { isMissingSchema, withOrg } from '@/lib/db'
import { listHistory, saveManualValue, type HistoryEntry } from '@/lib/fields'
import { removeListRow, saveListRow } from '@/lib/lists'
import { loadAccess, sectionOfField } from '@/lib/permissions'
import { getDocument, listDocuments, readDocumentFile, removeDocument } from '@/lib/documents'
import { extractPhotos } from '@/lib/photoExtraction'
import { joinSpreads } from '@/lib/photoJoin'
import { isPhotoCategory, removePhoto, savePhotosFromDocument, setMainPhoto, updatePhoto } from '@/lib/photos'
import { LOCATION_SOURCE, lookUpAddress, type AddressMatch, type FoundAddress } from '@/lib/geocode'
import { addressOfSuggestion, suggestAddresses, type Suggestion } from '@/lib/googlePlaces'
import { deleteRentRoll, getRentRoll, setRentRollDate } from '@/lib/rentRolls'
import { deleteAddress, formatAddress, getAddress, insertAddress, insertChild, isRecordType, isUuid, setAddressLocation, type AddressOwner, type Queryable } from '@/lib/records'

const NO_PERMISSION = "You don't have permission to change this."

// The organization always comes from the signed-in session, never from the
// browser. Record ids from the browser are checked against that organization
// in the data layer before anything is read or written.

export type SaveFieldResult = { ok: true } | { ok: false; error: string }

export async function saveField(input: {
  assetId: string
  recordType: string
  recordId: string
  fieldId: string
  month: string | null
  raw: string
  note: string | null
}): Promise<SaveFieldResult> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  const { recordType } = input
  if (!isRecordType(recordType) || !isUuid(input.recordId) || !isUuid(input.fieldId) || !isUuid(input.assetId)) {
    return { ok: false, error: 'That field could not be found.' }
  }

  try {
    const result = await withOrg(orgId, async (client) => {
      // The person's roles must allow editing this field.
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      const level = access.fieldLevel(input.fieldId, await sectionOfField(client, orgId, input.fieldId))
      if (level === 'hidden') return { ok: false as const, error: 'That field could not be found.' }
      if (level !== 'edit') return { ok: false as const, error: NO_PERMISSION }
      return saveManualValue(client, orgId, userId, {
        recordType,
        recordId: input.recordId,
        fieldId: input.fieldId,
        month: input.month,
        raw: String(input.raw ?? ''),
        note: input.note,
      })
    })
    if (!result.ok) return result
  } catch (error) {
    console.error('saveField failed', error)
    return { ok: false, error: 'That value could not be saved. Try again.' }
  }

  revalidatePath(`/dashboard/assets/${input.assetId}`)
  revalidatePath('/dashboard')
  return { ok: true }
}

export type HistoryRow = HistoryEntry & { changedByName: string }
export type LoadHistoryResult = { ok: true; entries: HistoryRow[] } | { ok: false; error: string }

export async function loadHistory(input: { recordType: string; recordId: string; fieldId: string }): Promise<LoadHistoryResult> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  const { recordType } = input
  if (!isRecordType(recordType) || !isUuid(input.recordId) || !isUuid(input.fieldId)) return { ok: false, error: 'That field could not be found.' }

  let entries: HistoryEntry[] | null
  try {
    entries = await withOrg(orgId, async (client) => {
      // History follows the field's permission: a hidden field has no visible history.
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      if (access.fieldLevel(input.fieldId, await sectionOfField(client, orgId, input.fieldId)) === 'hidden') return null
      return listHistory(client, orgId, recordType, input.recordId, input.fieldId)
    })
  } catch (error) {
    console.error('loadHistory failed', error)
    return { ok: false, error: 'The history could not be loaded. Try again.' }
  }
  if (!entries) return { ok: false, error: 'That field could not be found.' }

  // Show people's names instead of their account ids.
  const names = new Map<string, string>()
  const ids = [...new Set(entries.map((entry) => entry.changedBy))].filter((id) => id.startsWith('user_'))
  if (ids.length > 0) {
    try {
      const client = await clerkClient()
      const users = await client.users.getUserList({ userId: ids, limit: 100 })
      for (const user of users.data) {
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
        names.set(user.id, name || user.primaryEmailAddress?.emailAddress || 'A member')
      }
    } catch (error) {
      console.error('loadHistory: names could not be loaded', error)
    }
  }
  const found = entries
  return { ok: true, entries: found.map((entry) => ({ ...entry, changedByName: names.get(entry.changedBy) ?? 'A member' })) }
}

export type AddState = { error: string | null; done: number }

const CHILD_TYPES = ['property', 'building', 'floor', 'unit'] as const
type ChildType = (typeof CHILD_TYPES)[number]

/** Adds a property, building, floor or unit under its parent. */
export async function addChild(prev: AddState, formData: FormData): Promise<AddState> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { error: 'You need to be signed in to an organization.', done: prev.done }

  const type = String(formData.get('type') ?? '') as ChildType
  const parentId = String(formData.get('parentId') ?? '')
  const assetId = String(formData.get('assetId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const propertyTypeRaw = String(formData.get('propertyType') ?? '')

  if (!CHILD_TYPES.includes(type) || !isUuid(parentId) || !isUuid(assetId)) return { error: 'That could not be added.', done: prev.done }
  if (!name) return { error: 'Enter a name.', done: prev.done }
  if (name.length > 200) return { error: 'The name is too long.', done: prev.done }
  let propertyType: string | null = null
  if (type === 'property') {
    if (!(PROPERTY_TYPES as readonly string[]).includes(propertyTypeRaw)) return { error: 'Choose a property type.', done: prev.done }
    propertyType = propertyTypeRaw
  }

  try {
    const id = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      if (!access.canAddRecords) return 'denied' as const
      return insertChild(client, orgId, userId, type, parentId, name, propertyType)
    })
    if (id === 'denied') return { error: NO_PERMISSION, done: prev.done }
    if (!id) return { error: 'That could not be added.', done: prev.done }
  } catch (error) {
    console.error('addChild failed', error)
    return { error: 'That could not be added. Try again.', done: prev.done }
  }

  revalidatePath(`/dashboard/assets/${assetId}`)
  revalidatePath('/dashboard')
  return { error: null, done: prev.done + 1 }
}

const ADDRESS_OWNERS = ['property', 'building', 'unit'] as const

/** Adds an address to a property, building or unit. */
export async function addAddress(prev: AddState, formData: FormData): Promise<AddState> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { error: 'You need to be signed in to an organization.', done: prev.done }

  const ownerType = String(formData.get('ownerType') ?? '') as AddressOwner
  const ownerId = String(formData.get('ownerId') ?? '')
  const assetId = String(formData.get('assetId') ?? '')
  if (!ADDRESS_OWNERS.includes(ownerType) || !isUuid(ownerId) || !isUuid(assetId)) return { error: 'That address could not be added.', done: prev.done }

  const part = (name: string) => {
    const value = String(formData.get(name) ?? '').trim().slice(0, 200)
    return value || null
  }
  // Present when the address was picked from the lookup; a typed address has none.
  const coordinate = (name: string, limit: number) => {
    const text = String(formData.get(name) ?? '').trim()
    const value = Number(text)
    return text !== '' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null
  }
  const latitude = coordinate('latitude', 90)
  const longitude = coordinate('longitude', 180)
  const located = latitude !== null && longitude !== null
  const input = {
    street: part('street'),
    suite: part('suite'),
    city: part('city'),
    state: part('state'),
    postalCode: part('postalCode'),
    latitude: located ? latitude : null,
    longitude: located ? longitude : null,
    locationSource: located ? LOCATION_SOURCE : null,
  }
  if (!input.street && !input.city) return { error: 'Enter at least a street or a city.', done: prev.done }

  try {
    const added = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      if (!access.canAddRecords) return 'denied' as const
      return insertAddress(client, orgId, userId, ownerType, ownerId, input)
    })
    if (added === 'denied') return { error: NO_PERMISSION, done: prev.done }
    if (!added) return { error: 'That address could not be added.', done: prev.done }
  } catch (error) {
    console.error('addAddress failed', error)
    return { error: 'That address could not be added. Try again.', done: prev.done }
  }

  revalidatePath(`/dashboard/assets/${assetId}`)
  revalidatePath('/dashboard')
  return { error: null, done: prev.done + 1 }
}

export type RowResult = { ok: true } | { ok: false; error: string }

/** Adds an entry to a list, or changes one. */
export async function saveRow(input: {
  assetId: string
  listId: string
  recordType: string
  recordId: string
  rowId: string | null
  values: Record<string, string>
}): Promise<RowResult> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  const { recordType } = input
  if (!isRecordType(recordType) || !isUuid(input.recordId) || !isUuid(input.listId) || !isUuid(input.assetId) || (input.rowId !== null && !isUuid(input.rowId))) {
    return { ok: false, error: 'That entry could not be saved.' }
  }
  // Only keep entries that look like "field id -> text".
  const values: Record<string, string> = {}
  for (const [fieldId, raw] of Object.entries(input.values ?? {})) {
    if (isUuid(fieldId) && typeof raw === 'string') values[fieldId] = raw
  }

  try {
    const result = await withOrg(orgId, async (client) => {
      // A list follows the permission of the section it is shown in.
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      const list = await client.query('select section_id::text as section_id from field_lists where id = $1 and (org_id is null or org_id = $2)', [input.listId, orgId])
      if (list.rows.length === 0) return { ok: false as const, error: 'That list could not be found.' }
      const sectionId = list.rows[0].section_id as string | null
      const level = sectionId ? access.sectionLevel(sectionId) : access.fieldLevel(input.listId, null)
      if (level !== 'edit') return { ok: false as const, error: NO_PERMISSION }
      return saveListRow(client, orgId, userId, { listId: input.listId, recordType, recordId: input.recordId, rowId: input.rowId, values })
    })
    if (!result.ok) return result
  } catch (error) {
    console.error('saveRow failed', error)
    return { ok: false, error: 'That entry could not be saved. Try again.' }
  }

  revalidatePath(`/dashboard/assets/${input.assetId}`)
  return { ok: true }
}

/** Removes an entry from a list. Its values and history are kept in the database. */
export async function removeRow(input: { assetId: string; rowId: string }): Promise<RowResult> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  if (!isUuid(input.rowId) || !isUuid(input.assetId)) return { ok: false, error: 'That entry could not be found.' }

  try {
    const removed = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      const row = await client.query(
        `select l.id::text as list_id, l.section_id::text as section_id
         from field_list_rows r join field_lists l on l.id = r.list_id
         where r.id = $1 and r.org_id = $2`,
        [input.rowId, orgId],
      )
      if (row.rows.length === 0) return false
      const sectionId = row.rows[0].section_id as string | null
      const level = sectionId ? access.sectionLevel(sectionId) : access.fieldLevel(row.rows[0].list_id, null)
      if (level !== 'edit') return 'denied' as const
      return removeListRow(client, orgId, userId, input.rowId)
    })
    if (removed === 'denied') return { ok: false, error: NO_PERMISSION }
    if (!removed) return { ok: false, error: 'That entry could not be found.' }
  } catch (error) {
    console.error('removeRow failed', error)
    return { ok: false, error: 'That entry could not be removed. Try again.' }
  }

  revalidatePath(`/dashboard/assets/${input.assetId}`)
  return { ok: true }
}

/**
 * Deletes an asset and everything under it, for good. Administrators only;
 * the screen asks "are you sure" first, and this checks the role again.
 */
export async function deleteAssetForever(input: { assetId: string }): Promise<SaveFieldResult> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  if (orgRole !== 'org:admin') return { ok: false, error: 'Only administrators can delete an asset.' }
  if (!isUuid(input.assetId)) return { ok: false, error: 'That asset could not be found.' }
  try {
    const name = await withOrg(orgId, (client) => deleteAsset(client, orgId, input.assetId))
    if (name === null) return { ok: false, error: 'That asset could not be found. It may already have been deleted.' }
    console.info(`Asset deleted: "${name}" (${input.assetId}) in ${orgId} by ${userId}`)
  } catch (error) {
    console.error('deleteAssetForever failed', error)
    return { ok: false, error: 'The asset could not be deleted. Nothing was removed; try again.' }
  }
  revalidatePath('/dashboard')
  revalidatePath(`/dashboard/assets/${input.assetId}`)
  return { ok: true }
}

/**
 * Photo changes: make one the main photo, change its caption or what it
 * shows, or remove it. All need the same permission as adding a document.
 */
async function changePhoto(photoId: string, work: (client: Queryable, orgId: string) => Promise<string | null>): Promise<SaveFieldResult> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  if (!isUuid(photoId)) return { ok: false, error: 'That photo could not be found.' }
  try {
    const assetId = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      if (!access.canAddRecords) return false as const
      return work(client, orgId)
    })
    if (assetId === false) return { ok: false, error: NO_PERMISSION }
    if (assetId === null) return { ok: false, error: 'That photo could not be found. It may already have been removed.' }
    revalidatePath(`/dashboard/assets/${assetId}`)
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (error) {
    console.error('Changing a photo failed', error)
    return { ok: false, error: 'That could not be saved. Try again.' }
  }
}

export async function makeMainPhoto(input: { photoId: string }): Promise<SaveFieldResult> {
  return changePhoto(input.photoId, (client, orgId) => setMainPhoto(client, orgId, input.photoId))
}

export async function savePhotoDetails(input: { photoId: string; caption: string; category: string }): Promise<SaveFieldResult> {
  if (!isPhotoCategory(input.category)) return { ok: false, error: 'Choose what the photo shows.' }
  const category = input.category
  return changePhoto(input.photoId, (client, orgId) => updatePhoto(client, orgId, input.photoId, { caption: String(input.caption ?? ''), category }))
}

export async function deletePhoto(input: { photoId: string }): Promise<SaveFieldResult> {
  return changePhoto(input.photoId, (client, orgId) => removePhoto(client, orgId, input.photoId))
}

/**
 * Copies the photographs out of the documents this asset already has, for
 * documents that were read before photos existed. The agent is not asked
 * again, so these photos arrive without captions; ones already on the asset
 * are skipped.
 */
export async function pullPhotosFromDocuments(input: { assetId: string }): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  if (!isUuid(input.assetId)) return { ok: false, error: 'That asset could not be found.' }
  try {
    const files = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      if (!access.canAddRecords) return null
      const found: { documentId: string; file: Buffer }[] = []
      for (const document of await listDocuments(client, orgId, input.assetId)) {
        const file = await readDocumentFile(client, orgId, document.id)
        if (file) found.push({ documentId: document.id, file })
      }
      return found
    })
    if (files === null) return { ok: false, error: NO_PERMISSION }
    let added = 0
    for (const { documentId, file } of files) {
      const photos = await joinSpreads(await extractPhotos(file))
      if (photos.length === 0) continue
      added += await withOrg(orgId, (client) => savePhotosFromDocument(client, orgId, userId, { assetId: input.assetId, documentId, photos, notes: [], mainPage: null }))
    }
    revalidatePath(`/dashboard/assets/${input.assetId}`)
    revalidatePath('/dashboard')
    return { ok: true, added }
  } catch (error) {
    console.error('Pulling photos from documents failed', error)
    return { ok: false, error: 'The photos could not be pulled from the documents. Try again.' }
  }
}

export type FindAddressResult = { ok: true; matches: AddressMatch[] } | { ok: false; error: string }

/** Looks up a typed address for the Add Address form. Nothing is saved. */
export async function findAddress(input: { text: string }): Promise<FindAddressResult> {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  return lookUpAddress(String(input.text ?? ''))
}

export type SuggestAddressResult = { ok: true; suggestions: Suggestion[] } | { ok: false; error: string }

/** Suggestions under the address box while someone types (Google). Nothing is saved. */
export async function suggestAddress(input: { text: string; session: string }): Promise<SuggestAddressResult> {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  return suggestAddresses(String(input.text ?? ''), String(input.session ?? ''))
}

export type PickAddressResult = { ok: true; address: FoundAddress } | { ok: false; error: string }

/**
 * The address behind a suggestion the person picked: its parts from Google,
 * and its latitude and longitude from the Census lookup, which may be kept
 * (Google's may not). An address the Census lookup doesn't know comes back
 * without a location and can still be added.
 */
export async function pickSuggestedAddress(input: { placeId: string; session: string }): Promise<PickAddressResult> {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  const picked = await addressOfSuggestion(String(input.placeId ?? ''), String(input.session ?? ''))
  if (!picked.ok) return picked
  const { address } = picked
  const located = await lookUpAddress([address.street, address.city, [address.state, address.postalCode.slice(0, 5)].filter(Boolean).join(' ')].filter(Boolean).join(', '))
  const match = located.ok ? located.matches[0] : undefined
  return { ok: true, address: { ...address, latitude: match?.latitude ?? null, longitude: match?.longitude ?? null } }
}

/** Runs a change to one address for someone allowed to add records, then refreshes its asset's page. */
async function changeAddress<T>(addressId: string, work: (client: Queryable, orgId: string, address: NonNullable<Awaited<ReturnType<typeof getAddress>>>) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  if (!isUuid(addressId)) return { ok: false, error: 'That address could not be found.' }
  try {
    const result = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      if (!access.canAddRecords) return { ok: false as const, error: NO_PERMISSION }
      const address = await getAddress(client, orgId, addressId)
      if (!address) return { ok: false as const, error: 'That address could not be found.' }
      return { ok: true as const, value: await work(client, orgId, address), assetId: address.assetId }
    })
    if (!result.ok) return result
    revalidatePath(`/dashboard/assets/${result.assetId}`)
    revalidatePath('/dashboard')
    return { ok: true, value: result.value }
  } catch (error) {
    console.error('Changing an address failed', error)
    return { ok: false, error: isMissingSchema(error) ? 'Locations need a database update: run db/migrations/015_address_coordinates.sql.' : 'That could not be saved. Try again.' }
  }
}

/**
 * Finds where an address that was typed by hand is on the map and saves its
 * latitude and longitude. The address text itself is left as it was.
 */
export async function locateAddress(input: { addressId: string }): Promise<SaveFieldResult> {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  if (!isUuid(input.addressId)) return { ok: false, error: 'That address could not be found.' }
  // Read the address, look it up with no database transaction open, then save.
  let text: string
  try {
    const address = await withOrg(orgId, (client) => getAddress(client, orgId, input.addressId))
    if (!address) return { ok: false, error: 'That address could not be found.' }
    if (!address.street) return { ok: false, error: 'This address has no street, so it can\'t be placed on a map. Remove it and add the full address.' }
    text = formatAddress({ ...address, suite: null })
  } catch (error) {
    console.error('Reading an address failed', error)
    return { ok: false, error: 'That address could not be read. Try again.' }
  }
  const found = await lookUpAddress(text)
  if (!found.ok) return found
  const match = found.matches[0]
  if (!match) return { ok: false, error: 'The lookup did not find this address. Check the street, city and state, or remove it and add it again.' }
  const saved = await changeAddress(input.addressId, (client, org) => setAddressLocation(client, org, input.addressId, match.latitude, match.longitude, LOCATION_SOURCE))
  return saved.ok ? { ok: true } : saved
}

/** Removes an address, for example one picked by mistake. */
export async function removeAddress(input: { addressId: string }): Promise<SaveFieldResult> {
  const removed = await changeAddress(input.addressId, (client, org) => deleteAddress(client, org, input.addressId))
  return removed.ok ? { ok: true } : removed
}

/** Runs a change to one rent roll for someone allowed to add records, then refreshes its asset's page. */
async function changeRentRoll(rentRollId: string, work: (client: Queryable, orgId: string) => Promise<boolean>): Promise<SaveFieldResult> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  if (!isUuid(rentRollId)) return { ok: false, error: 'That rent roll could not be found.' }
  try {
    const result = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      if (!access.canAddRecords) return { ok: false as const, error: NO_PERMISSION }
      const rentRoll = await getRentRoll(client, orgId, rentRollId)
      if (!rentRoll || !(await work(client, orgId))) return { ok: false as const, error: 'That rent roll could not be found.' }
      return { ok: true as const, assetId: rentRoll.assetId }
    })
    if (!result.ok) return result
    revalidatePath(`/dashboard/assets/${result.assetId}`)
    return { ok: true }
  } catch (error) {
    console.error('Changing a rent roll failed', error)
    return { ok: false, error: 'That could not be saved. Try again.' }
  }
}

/** Sets the date a rent roll is as of, for example when the document did not state one. */
export async function changeRentRollDate(input: { rentRollId: string; date: string }): Promise<SaveFieldResult> {
  const date = String(input.date ?? '')
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return { ok: false, error: 'Choose a date.' }
  if (parsed.getUTCFullYear() < 1950 || parsed.getUTCFullYear() > 2100) return { ok: false, error: 'That date is out of range.' }
  return changeRentRoll(input.rentRollId, (client, orgId) => setRentRollDate(client, orgId, input.rentRollId, date))
}

/**
 * Deletes one rent roll snapshot and its rows, for good. With `withDocument`
 * the document it came from is deleted too (by an administrator or the person
 * who uploaded it, as on the document's own page), so the file can be loaded
 * again from scratch.
 */
export async function removeRentRoll(input: { rentRollId: string; withDocument?: boolean }): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return { ok: false, error: 'You need to be signed in to an organization.' }
  if (!isUuid(input.rentRollId)) return { ok: false, error: 'That rent roll could not be found.' }
  try {
    const result = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      if (!access.canAddRecords) return { ok: false as const, error: NO_PERMISSION }
      const rentRoll = await getRentRoll(client, orgId, input.rentRollId)
      if (!rentRoll || !(await deleteRentRoll(client, orgId, input.rentRollId))) return { ok: false as const, error: 'That rent roll could not be found. It may already have been deleted; reload the page.' }
      let message = 'The rent roll was deleted.'
      if (input.withDocument === true && rentRoll.documentId) {
        const document = await getDocument(client, orgId, rentRoll.documentId)
        if (document && (orgRole === 'org:admin' || document.uploadedBy === userId)) {
          await removeDocument(client, orgId, document.id)
          message = 'The rent roll and its document were deleted. You can load the file again.'
        } else if (document) {
          message = 'The rent roll was deleted. Its document was kept: only an administrator or the person who uploaded it can delete a document.'
        }
      }
      return { ok: true as const, assetId: rentRoll.assetId, message }
    })
    if (!result.ok) return result
    revalidatePath(`/dashboard/assets/${result.assetId}`)
    return { ok: true, message: result.message }
  } catch (error) {
    console.error('Deleting a rent roll failed', error)
    return { ok: false, error: 'The rent roll could not be deleted. Try again.' }
  }
}
