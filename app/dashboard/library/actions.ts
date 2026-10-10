'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { withStratiosAdmin } from '@/lib/db'
import {
  createField,
  createList,
  createScreen,
  createSection,
  placeStandardField,
  optionsMessage,
  readOptionRows,
  retireStandardField,
  saveFieldOptions,
  saveStandardField,
  type FieldSettingsInput,
} from '@/lib/fieldAdmin'
import { isUuid } from '@/lib/records'
import { isStratiosAdmin } from '@/lib/stratios'
import { listFields } from '@/lib/fields'
import type { ActionResult, FormState, OptionsResult } from '../fields/actions'

// The Master Library changes the Stratios standard for every organization.
// Every action first confirms the signed-in person is an administrator of the
// Stratios organization; only then may the database transaction touch
// standard rows (withStratiosAdmin).
async function requireStratiosAdmin() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId || !(await isStratiosAdmin(orgId, orgRole))) return null
  return { userId, orgId }
}

const NOT_ALLOWED = 'Only Stratios administrators can change the master library.'

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '')
const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
const idOrNull = (value: string) => (isUuid(value) ? value : null)

export async function addLibraryField(prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { error: NOT_ALLOWED, message: null, done: prev.done }
  const showIn = text(formData, 'showIn')
  try {
    const result = await withStratiosAdmin(admin.orgId, (client) =>
      createField(client, null, {
        name: text(formData, 'name'),
        appliesTo: text(formData, 'appliesTo'),
        dataType: text(formData, 'dataType'),
        unit: text(formData, 'unit'),
        options: lines(text(formData, 'options')),
        tracking: text(formData, 'tracking'),
        sectionId: showIn.startsWith('section:') ? idOrNull(showIn.slice(8)) : null,
        listId: showIn.startsWith('list:') ? idOrNull(showIn.slice(5)) : null,
        aiDescription: text(formData, 'aiDescription'),
      }),
    )
    if (!result.ok) return { error: result.error, message: null, done: prev.done }
    revalidatePath('/dashboard/library')
    return { error: null, message: `Standard field added for every organization. Its key is ${result.key}.`, done: prev.done + 1 }
  } catch (error) {
    console.error('addLibraryField failed', error)
    return { error: 'The field could not be added. Check that the newest database update has been run.', message: null, done: prev.done }
  }
}

export async function addLibraryScreen(prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { error: NOT_ALLOWED, message: null, done: prev.done }
  try {
    const result = await withStratiosAdmin(admin.orgId, (client) => createScreen(client, null, text(formData, 'name')))
    if (!result.ok) return { error: result.error, message: null, done: prev.done }
    revalidatePath('/dashboard/layout-library')
    revalidatePath('/dashboard/library')
    return { error: null, message: 'Standard screen added for every organization.', done: prev.done + 1 }
  } catch (error) {
    console.error('addLibraryScreen failed', error)
    return { error: 'The screen could not be added. Try again.', message: null, done: prev.done }
  }
}

export async function addLibrarySection(prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { error: NOT_ALLOWED, message: null, done: prev.done }
  const screenId = idOrNull(text(formData, 'screenId'))
  if (!screenId) return { error: 'Choose a screen.', message: null, done: prev.done }
  const kind = text(formData, 'kind')
  try {
    const result = await withStratiosAdmin(admin.orgId, (client) =>
      kind === 'list'
        ? createList(client, null, { name: text(formData, 'name'), screenId, appliesTo: text(formData, 'appliesTo') })
        : createSection(client, null, { name: text(formData, 'name'), screenId, appliesTo: text(formData, 'appliesTo'), displayStyle: kind }),
    )
    if (!result.ok) return { error: result.error, message: null, done: prev.done }
    revalidatePath('/dashboard/layout-library')
    revalidatePath('/dashboard/library')
    return { error: null, message: kind === 'list' ? 'Standard list added. Add its columns in Fields Library, choosing the list under Show In.' : 'Standard section added.', done: prev.done + 1 }
  } catch (error) {
    console.error('addLibrarySection failed', error)
    return { error: 'That could not be added. Try again.', message: null, done: prev.done }
  }
}

export async function saveLibraryField(input: { fieldId: string; settings: FieldSettingsInput; sectionId: string | null; moveSection: boolean }): Promise<ActionResult> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { ok: false, error: NOT_ALLOWED }
  if (!isUuid(input.fieldId) || (input.sectionId !== null && !isUuid(input.sectionId))) return { ok: false, error: 'That field could not be found.' }
  const raw = input.settings ?? ({} as FieldSettingsInput)
  const list = (value: unknown) => (Array.isArray(value) ? value.map((item) => String(item)) : [])
  const settings: FieldSettingsInput = {
    name: String(raw.name ?? ''),
    aiDescription: String(raw.aiDescription ?? ''),
    agentInstructions: String(raw.agentInstructions ?? ''),
    whenEmpty: String(raw.whenEmpty ?? ''),
    whenDifferent: String(raw.whenDifferent ?? ''),
    manualOverride: String(raw.manualOverride ?? ''),
    unit: String(raw.unit ?? ''),
    options: list(raw.options),
  }
  try {
    const result = await withStratiosAdmin(admin.orgId, async (client) => {
      const saved = await saveStandardField(client, input.fieldId, settings)
      if (!saved.ok) return saved
      if (input.moveSection) {
        const placed = await placeStandardField(client, input.fieldId, input.sectionId)
        if (!placed.ok) throw new Error(placed.error) // undo the settings too
      }
      return saved
    })
    if (!result.ok) return result
  } catch (error) {
    console.error('saveLibraryField failed', error)
    return { ok: false, error: 'The changes could not be saved. Try again.' }
  }
  revalidatePath('/dashboard/library')
  revalidatePath(`/dashboard/library/${input.fieldId}`)
  return { ok: true, message: 'Saved. The change is live for every organization, except where they have modified that setting.' }
}

export async function retireLibraryField(input: { fieldId: string }): Promise<ActionResult> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { ok: false, error: NOT_ALLOWED }
  if (!isUuid(input.fieldId)) return { ok: false, error: 'That field could not be found.' }
  try {
    const result = await withStratiosAdmin(admin.orgId, (client) => retireStandardField(client, input.fieldId))
    if (!result.ok) return result
  } catch (error) {
    console.error('retireLibraryField failed', error)
    return { ok: false, error: 'The field could not be retired. Try again.' }
  }
  revalidatePath('/dashboard/library')
  return { ok: true, message: 'Field retired.' }
}

/** Saves a standard pick list's choices for every organization that has not made its own version of the list. */
export async function saveLibraryOptions(input: { fieldId: string; options: unknown }): Promise<OptionsResult> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { ok: false, error: NOT_ALLOWED }
  if (!isUuid(input.fieldId)) return { ok: false, error: 'That field could not be found.' }
  const rows = readOptionRows(input.options)
  try {
    const result = await withStratiosAdmin(admin.orgId, async (client) => {
      const saved = await saveFieldOptions(client, null, admin.userId, input.fieldId, rows)
      if (!saved.ok) return saved
      const field = (await listFields(client, null)).find((candidate) => candidate.id === input.fieldId)
      return { ...saved, options: (field?.optionList ?? []).map(({ key, label, parent, countsAs, retired }) => ({ key, label, parent, countsAs, retired })) }
    })
    if (!result.ok) return result
    revalidatePath('/dashboard')
    revalidatePath('/dashboard/library')
    revalidatePath(`/dashboard/library/${input.fieldId}`)
    return { ok: true, message: optionsMessage(result.kept, true), options: result.options }
  } catch (error) {
    console.error('saveLibraryOptions failed', error)
    return { ok: false, error: 'The options could not be saved. Try again.' }
  }
}
