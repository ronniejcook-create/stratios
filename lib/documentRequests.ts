// Shared by the document API routes: who is asking, and plain JSON answers.

import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, isMissingSchema } from './db'

export type Caller = { userId: string; orgId: string; isAdmin: boolean }

/** The signed-in person and their organization, always taken from the session and never from the request. */
export async function getCaller(): Promise<Caller | null> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId || !isDatabaseConfigured()) return null
  return { userId, orgId, isAdmin: orgRole === 'org:admin' }
}

export const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export const fail = (error: string, status = 400) => json({ ok: false, error }, status)

export const NOT_SIGNED_IN = 'You need to be signed in to an organization.'
export const NO_PERMISSION = "You don't have permission to add documents. Ask an administrator for a role that can edit."

/** A readable reason for an unexpected failure, pointing at the database update when that is the cause. */
export function describeFailure(error: unknown, fallback: string): string {
  return isMissingSchema(error) ? 'The database needs an update before documents can be used: run db/migrations/008_documents.sql.' : fallback
}
