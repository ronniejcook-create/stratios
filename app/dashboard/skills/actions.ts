'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { isMissingSchema, withStratiosAdmin } from '@/lib/db'
import { isUuid } from '@/lib/records'
import { createSkill, deleteSkill, updateSkill, type SkillInput } from '@/lib/skills'
import { isStratiosAdmin } from '@/lib/stratios'

export type ActionResult = { ok: true; message: string; id?: string } | { ok: false; error: string }

// The library applies to every organization, so only administrators of the
// Stratios organization may change it.
async function requireStratiosAdmin() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId || !(await isStratiosAdmin(orgId, orgRole))) return null
  return { userId, orgId }
}

const NOT_ALLOWED = 'Only Stratios administrators can change the skills library.'
const failure = (error: unknown) =>
  isMissingSchema(error) ? 'The database needs an update first: run db/migrations/011_skills.sql.' : 'That could not be saved. Try again.'

const read = (input: SkillInput): SkillInput => ({
  name: String(input?.name ?? ''),
  useWhen: String(input?.useWhen ?? ''),
  instructions: String(input?.instructions ?? ''),
  enabled: input?.enabled !== false,
})

export async function addSkill(input: SkillInput): Promise<ActionResult> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { ok: false, error: NOT_ALLOWED }
  try {
    const result = await withStratiosAdmin(admin.orgId, (client) => createSkill(client, admin.userId, read(input)))
    if (!result.ok) return result
    revalidatePath('/dashboard/skills')
    return { ok: true, message: 'Skill added.', id: result.id }
  } catch (error) {
    console.error('addSkill failed', error)
    return { ok: false, error: failure(error) }
  }
}

export async function saveSkill(input: SkillInput & { id: string }): Promise<ActionResult> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { ok: false, error: NOT_ALLOWED }
  if (!isUuid(String(input?.id ?? ''))) return { ok: false, error: 'That skill could not be found.' }
  try {
    const result = await withStratiosAdmin(admin.orgId, (client) => updateSkill(client, admin.userId, input.id, read(input)))
    if (!result.ok) return result
    revalidatePath('/dashboard/skills')
    revalidatePath(`/dashboard/skills/${input.id}`)
    return { ok: true, message: 'Saved. The agents use it from their next task, for every organization.' }
  } catch (error) {
    console.error('saveSkill failed', error)
    return { ok: false, error: failure(error) }
  }
}

export async function removeSkill(input: { id: string }): Promise<ActionResult> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { ok: false, error: NOT_ALLOWED }
  if (!isUuid(String(input?.id ?? ''))) return { ok: false, error: 'That skill could not be found.' }
  try {
    const removed = await withStratiosAdmin(admin.orgId, (client) => deleteSkill(client, input.id))
    if (!removed) return { ok: false, error: 'That skill could not be found.' }
    revalidatePath('/dashboard/skills')
    return { ok: true, message: 'Skill removed.' }
  } catch (error) {
    console.error('removeSkill failed', error)
    return { ok: false, error: failure(error) }
  }
}
