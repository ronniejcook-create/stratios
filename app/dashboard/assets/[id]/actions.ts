'use server'

import { revalidatePath } from 'next/cache'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { PROPERTY_TYPES } from '@/lib/assets'
import { withOrg } from '@/lib/db'
import { listHistory, saveManualValue, type HistoryEntry } from '@/lib/fields'
import { removeListRow, saveListRow } from '@/lib/lists'
import { loadAccess, sectionOfField } from '@/lib/permissions'
import { insertAddress, insertChild, isRecordType, isUuid, type AddressOwner } from '@/lib/records'

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
  const input = { street: part('street'), suite: part('suite'), city: part('city'), state: part('state'), postalCode: part('postalCode') }
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
