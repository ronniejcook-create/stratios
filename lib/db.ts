import { Pool, type PoolClient } from 'pg'

const globalForDb = globalThis as unknown as { stratiosPool?: Pool }

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set')
  }
  if (!globalForDb.stratiosPool) {
    globalForDb.stratiosPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
  }
  return globalForDb.stratiosPool
}

/** Runs one query outside any organization scope (for tables without per-organization rules). */
export async function query<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query<T>(text, params)
  return result.rows
}

/**
 * Runs `fn` in a transaction scoped to one organization.
 * The organization ID is stored in a transaction-local setting that the
 * row-level security policies read, so queries inside `fn` can only see and
 * write that organization's rows.
 */
export async function withOrg<T>(orgId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    await client.query("select set_config('app.org_id', $1, true)", [orgId])
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * Like withOrg, but also lets the transaction change Stratios standard rows
 * (the ones with no organization) and read every organization's field
 * customizations. Only call this after confirming the signed-in person is an
 * administrator of the Stratios organization (see lib/stratios.ts).
 */
export async function withStratiosAdmin<T>(orgId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withOrg(orgId, async (client) => {
    await client.query("select set_config('app.stratios_admin', 'on', true)")
    return fn(client)
  })
}

/**
 * True when a query failed because a table or column doesn't exist yet,
 * which means the newest file in db/migrations hasn't been run.
 */
export function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === '42P01' || code === '42703'
}
