'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { isMissingSchema, withOrg } from '@/lib/db'
import { isUuid } from '@/lib/records'
import { createSkill, deleteSkill, resetSkill, saveSkill, type SkillActionResult, type SkillInput } from '@/lib/skills'

// An organization's skills: its own, and its own versions of Stratios
// standard skills. Only its administrators may change them, and the
// organization always comes from the signed-in session.
async function requireAdmin() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId || orgRole !== 'org:admin') return null
  return { userId, orgId }
}

const NOT_ADMIN = 'Only administrators can change skills.'
const NOT_FOUND = 'That skill could not be found.'
const failure = (error: unknown) =>
  isMissingSchema(error) ? 'The database needs an update first: run the newest files in db/migrations.' : 'That could not be saved. Try again.'

const read = (input: SkillInput): SkillInput => ({
  name: String(input?.name ?? ''),
  useWhen: String(input?.useWhen ?? ''),
  instructions: String(input?.instructions ?? ''),
  enabled: input?.enabled !== false,
})

function refresh(id?: string) {
  revalidatePath('/dashboard/skills')
  if (id) revalidatePath(`/dashboard/skills/${id}`)
}

export async function addOrgSkill(input: SkillInput): Promise<SkillActionResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: NOT_ADMIN }
  try {
    const result = await withOrg(admin.orgId, (client) => createSkill(client, admin.orgId, admin.userId, read(input)))
    if (!result.ok) return result
    refresh()
    return { ok: true, message: 'Skill added.', id: result.id }
  } catch (error) {
    console.error('addOrgSkill failed', error)
    return { ok: false, error: failure(error) }
  }
}

export async function saveOrgSkill(input: SkillInput & { id: string }): Promise<SkillActionResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: NOT_ADMIN }
  if (!isUuid(String(input?.id ?? ''))) return { ok: false, error: NOT_FOUND }
  try {
    const result = await withOrg(admin.orgId, (client) => saveSkill(client, admin.orgId, admin.userId, input.id, read(input)))
    if (!result.ok) return result
    refresh(input.id)
    refresh(result.id)
    return {
      ok: true,
      id: result.id,
      message:
        result.source === 'modified' ? 'Saved for your organization. This skill no longer follows Stratios updates; Reset to Standard puts it back.' :
        result.source === 'standard' ? 'This matches the Stratios standard, so your organization follows the standard skill.' :
        'Saved. The agents use it from their next task.',
    }
  } catch (error) {
    console.error('saveOrgSkill failed', error)
    return { ok: false, error: failure(error) }
  }
}

export async function resetOrgSkill(input: { id: string }): Promise<SkillActionResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: NOT_ADMIN }
  if (!isUuid(String(input?.id ?? ''))) return { ok: false, error: NOT_FOUND }
  try {
    const standardId = await withOrg(admin.orgId, (client) => resetSkill(client, admin.orgId, input.id))
    if (!standardId) return { ok: false, error: NOT_FOUND }
    refresh(input.id)
    refresh(standardId)
    return { ok: true, message: 'Back to the Stratios standard.', id: standardId }
  } catch (error) {
    console.error('resetOrgSkill failed', error)
    return { ok: false, error: failure(error) }
  }
}

export async function removeOrgSkill(input: { id: string }): Promise<SkillActionResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: NOT_ADMIN }
  if (!isUuid(String(input?.id ?? ''))) return { ok: false, error: NOT_FOUND }
  try {
    const result = await withOrg(admin.orgId, (client) => deleteSkill(client, admin.orgId, input.id))
    if (!result.ok) return result
    refresh()
    return { ok: true, message: 'Skill removed.' }
  } catch (error) {
    console.error('removeOrgSkill failed', error)
    return { ok: false, error: failure(error) }
  }
}
