'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import { resetAnalystInstructions, saveAnalystInstructions } from '@/lib/analystInstructions'
import { isMissingSchema, withStratiosAdmin } from '@/lib/db'
import { isStratiosAdmin } from '@/lib/stratios'

export type ActionResult = { ok: true; message: string } | { ok: false; error: string }

// The analyst's instructions apply to every organization, so only
// administrators of the Stratios organization may change them.
async function requireStratiosAdmin() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId || !(await isStratiosAdmin(orgId, orgRole))) return null
  return { userId, orgId }
}

const NOT_ALLOWED = 'Only Stratios administrators can change the analyst\'s instructions.'
const failure = (error: unknown) =>
  isMissingSchema(error) ? 'The database needs an update first: run db/migrations/010_analyst_instructions.sql.' : 'The instructions could not be saved. Try again.'

export async function saveInstructions(input: { instructions: string }): Promise<ActionResult> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { ok: false, error: NOT_ALLOWED }
  try {
    const result = await withStratiosAdmin(admin.orgId, (client) => saveAnalystInstructions(client, admin.userId, String(input?.instructions ?? '')))
    if (!result.ok) return result
  } catch (error) {
    console.error('saveInstructions failed', error)
    return { ok: false, error: failure(error) }
  }
  revalidatePath('/dashboard/analyst')
  return { ok: true, message: 'Saved. The analyst uses these instructions from its next reply, for every organization.' }
}

export async function resetInstructions(): Promise<ActionResult> {
  const admin = await requireStratiosAdmin()
  if (!admin) return { ok: false, error: NOT_ALLOWED }
  try {
    await withStratiosAdmin(admin.orgId, (client) => resetAnalystInstructions(client))
  } catch (error) {
    console.error('resetInstructions failed', error)
    return { ok: false, error: failure(error) }
  }
  revalidatePath('/dashboard/analyst')
  return { ok: true, message: 'Back to the built-in instructions.' }
}
