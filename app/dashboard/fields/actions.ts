'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { withOrg } from '@/lib/db'
import {
  createField,
  createList,
  createScreen,
  createSection,
  placeField,
  resetFieldSettings,
  retireField,
  saveFieldSettings,
  type FieldSettingsInput,
} from '@/lib/fieldAdmin'
import { generateFieldDescription, type DescriptionResult, type FieldFacts } from '@/lib/fieldDescription'
import { OVERRIDABLE } from '@/lib/fields'
import { isUuid } from '@/lib/records'

// Only administrators manage the field dictionary and the layout. The
// organization always comes from the signed-in session.
async function requireAdmin() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId || orgRole !== 'org:admin') return null
  return { userId, orgId }
}

const NOT_ADMIN = 'Only administrators can change fields and layout.'

export type FormState = { error: string | null; message: string | null; done: number }

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '')
const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
const idOrNull = (value: string) => (isUuid(value) ? value : null)

export async function addField(prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin()
  if (!admin) return { error: NOT_ADMIN, message: null, done: prev.done }

  // "Show In" is either a section ("section:<id>") or a list ("list:<id>").
  const showIn = text(formData, 'showIn')
  const sectionId = showIn.startsWith('section:') ? idOrNull(showIn.slice(8)) : null
  const listId = showIn.startsWith('list:') ? idOrNull(showIn.slice(5)) : null

  try {
    const result = await withOrg(admin.orgId, (client) =>
      createField(client, admin.orgId, {
        name: text(formData, 'name'),
        appliesTo: text(formData, 'appliesTo'),
        dataType: text(formData, 'dataType'),
        unit: text(formData, 'unit'),
        options: lines(text(formData, 'options')),
        tracking: text(formData, 'tracking'),
        sectionId,
        listId,
        aiDescription: text(formData, 'aiDescription'),
      }),
    )
    if (!result.ok) return { error: result.error, message: null, done: prev.done }
    revalidatePath('/dashboard/fields')
    return { error: null, message: `Field added. Its key is ${result.key}.`, done: prev.done + 1 }
  } catch (error) {
    console.error('addField failed', error)
    return { error: 'The field could not be added. Try again.', message: null, done: prev.done }
  }
}

export async function addScreen(prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin()
  if (!admin) return { error: NOT_ADMIN, message: null, done: prev.done }
  try {
    const result = await withOrg(admin.orgId, (client) => createScreen(client, admin.orgId, text(formData, 'name')))
    if (!result.ok) return { error: result.error, message: null, done: prev.done }
    revalidatePath('/dashboard/fields')
    return { error: null, message: 'Screen added.', done: prev.done + 1 }
  } catch (error) {
    console.error('addScreen failed', error)
    return { error: 'The screen could not be added. Try again.', message: null, done: prev.done }
  }
}

export async function addSection(prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin()
  if (!admin) return { error: NOT_ADMIN, message: null, done: prev.done }
  const screenId = idOrNull(text(formData, 'screenId'))
  if (!screenId) return { error: 'Choose a screen.', message: null, done: prev.done }
  const kind = text(formData, 'kind') // form, tiles or list
  try {
    const result = await withOrg(admin.orgId, (client) =>
      kind === 'list'
        ? createList(client, admin.orgId, { name: text(formData, 'name'), screenId, appliesTo: text(formData, 'appliesTo') })
        : createSection(client, admin.orgId, { name: text(formData, 'name'), screenId, appliesTo: text(formData, 'appliesTo'), displayStyle: kind }),
    )
    if (!result.ok) return { error: result.error, message: null, done: prev.done }
    revalidatePath('/dashboard/fields')
    return {
      error: null,
      message: kind === 'list' ? 'List added. Add its columns with "Add a Field" and choose the list under Show In.' : 'Section added.',
      done: prev.done + 1,
    }
  } catch (error) {
    console.error('addSection failed', error)
    return { error: 'That could not be added. Try again.', message: null, done: prev.done }
  }
}

export type ActionResult = { ok: true; message: string } | { ok: false; error: string }

export async function saveSettings(input: { fieldId: string; settings: FieldSettingsInput; sectionId: string | null; moveSection: boolean }): Promise<ActionResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: NOT_ADMIN }
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
    dataType: String(raw.dataType ?? ''),
  }

  try {
    const result = await withOrg(admin.orgId, async (client) => {
      const saved = await saveFieldSettings(client, admin.orgId, admin.userId, input.fieldId, settings)
      if (!saved.ok) return saved
      if (input.moveSection) {
        const placed = await placeField(client, admin.orgId, input.fieldId, input.sectionId)
        if (!placed.ok) throw new Error(placed.error) // undo the settings too
      }
      return saved
    })
    if (!result.ok) return result
  } catch (error) {
    console.error('saveSettings failed', error)
    return { ok: false, error: 'The changes could not be saved. Try again.' }
  }
  revalidatePath('/dashboard/fields')
  revalidatePath(`/dashboard/fields/${input.fieldId}`)
  return { ok: true, message: 'Changes saved.' }
}

export async function resetSettings(input: { fieldId: string; setting: string | null }): Promise<ActionResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: NOT_ADMIN }
  if (!isUuid(input.fieldId)) return { ok: false, error: 'That field could not be found.' }
  if (input.setting !== null && !(input.setting in OVERRIDABLE)) return { ok: false, error: 'That setting could not be found.' }
  try {
    await withOrg(admin.orgId, (client) => resetFieldSettings(client, admin.orgId, input.fieldId, input.setting))
  } catch (error) {
    console.error('resetSettings failed', error)
    return { ok: false, error: 'The field could not be reset. Try again.' }
  }
  revalidatePath('/dashboard/fields')
  revalidatePath(`/dashboard/fields/${input.fieldId}`)
  return { ok: true, message: input.setting ? 'Setting reset to the Stratios standard.' : 'Field reset to the Stratios standard.' }
}

export async function removeField(input: { fieldId: string }): Promise<ActionResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: NOT_ADMIN }
  if (!isUuid(input.fieldId)) return { ok: false, error: 'That field could not be found.' }
  try {
    const result = await withOrg(admin.orgId, (client) => retireField(client, admin.orgId, input.fieldId))
    if (!result.ok) return result
  } catch (error) {
    console.error('removeField failed', error)
    return { ok: false, error: 'The field could not be removed. Try again.' }
  }
  revalidatePath('/dashboard/fields')
  return { ok: true, message: 'Field removed.' }
}

/**
 * Asks Claude to write a field's description. Nothing is saved here: the
 * text goes back into the Description box for the administrator to review.
 * Also used by the Master Library, whose users are administrators too.
 */
export async function generateDescription(input: FieldFacts): Promise<DescriptionResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: NOT_ADMIN }
  const raw = input ?? ({} as FieldFacts)
  const list = (value: unknown) => (Array.isArray(value) ? value.map((item) => String(item)) : [])
  return generateFieldDescription({
    name: String(raw.name ?? ''),
    appliesTo: String(raw.appliesTo ?? ''),
    dataType: String(raw.dataType ?? ''),
    unit: String(raw.unit ?? ''),
    options: list(raw.options),
    tracking: String(raw.tracking ?? ''),
    calculated: raw.calculated === true,
  })
}
