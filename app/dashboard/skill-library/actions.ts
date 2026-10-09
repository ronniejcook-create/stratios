'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { isMissingSchema, withStratiosAdmin } from '@/lib/db'
import { isUuid } from '@/lib/records'
import { createSkill, deleteSkill, saveSkill, type SkillActionResult, type SkillInput } from '@/lib/skills'
import { isStratiosAdmin } from '@/lib/stratios'

// The Stratios standard skills reach every organization, so only
// administrators of the Stratios organization may change them.
async function requireStratiosAdmin() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId || !(await isStratiosAdmin(orgId, orgRole))) return null
  return { userId, orgId }
}

const NOT_ALLOWED = 'Only Stratios administrators can change the skills library.'
const NOT_FOUND = 'That skill could not be found.'
const failure = (error: unknown) =>
  isMissingSchema(error) ? 'The database needs an update first: run the newest files in db/migrations.' : 'That could not be saved. Try again.'

const read = (input: SkillInput): SkillInput => ({
  name: String(input?.name ?? ''),
  useWhen: String(input?.useWhen ?? ''),
  instructions: String(input?.instructions ?? ''),
  enabled: input?.enabled !== false,
})

export async function addLibrarySkill(input: SkillInput): Promise<SkillActionResult> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { ok: false, error: NOT_ALLOWED }
  try {
    const result = await withStratiosAdmin(admin.orgId, (client) => createSkill(client, null, admin.userId, read(input)))
    if (!result.ok) return result
    revalidatePath('/dashboard/skill-library')
    return { ok: true, message: 'Standard skill added.', id: result.id }
  } catch (error) {
    console.error('addLibrarySkill failed', error)
    return { ok: false, error: failure(error) }
  }
}

export async function saveLibrarySkill(input: SkillInput & { id: string }): Promise<SkillActionResult> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { ok: false, error: NOT_ALLOWED }
  if (!isUuid(String(input?.id ?? ''))) return { ok: false, error: NOT_FOUND }
  try {
    const result = await withStratiosAdmin(admin.orgId, (client) => saveSkill(client, null, admin.userId, input.id, read(input)))
    if (!result.ok) return result
    revalidatePath('/dashboard/skill-library')
    revalidatePath(`/dashboard/skill-library/${input.id}`)
    return { ok: true, message: 'Saved. The change is live for every organization, except those that have their own version of this skill.' }
  } catch (error) {
    console.error('saveLibrarySkill failed', error)
    return { ok: false, error: failure(error) }
  }
}

export async function removeLibrarySkill(input: { id: string }): Promise<SkillActionResult> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { ok: false, error: NOT_ALLOWED }
  if (!isUuid(String(input?.id ?? ''))) return { ok: false, error: NOT_FOUND }
  try {
    const result = await withStratiosAdmin(admin.orgId, (client) => deleteSkill(client, null, input.id))
    if (!result.ok) return result
    revalidatePath('/dashboard/skill-library')
    return { ok: true, message: 'Standard skill removed.' }
  } catch (error) {
    console.error('removeLibrarySkill failed', error)
    return { ok: false, error: failure(error) }
  }
}
