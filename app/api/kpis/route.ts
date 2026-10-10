import { revalidatePath } from 'next/cache'
import { fail, getCaller, json, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { calculateKpis, describeKpiRuns } from '@/lib/kpis'
import { isUuid } from '@/lib/records'

// One question to Claude per property that has a rent roll.
export const maxDuration = 300

/**
 * Calculates an asset's KPIs from its stored leases, following the KPI skill
 * that fits each property's kind (see lib/kpis.ts). Pressed as Recalculate
 * KPIs on the Leases tab, and asked for by the browser after a rent roll has
 * been loaded.
 */
export async function POST(request: Request) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const body = (await request.json().catch(() => null)) as { assetId?: unknown } | null
  const assetId = typeof body?.assetId === 'string' ? body.assetId : ''
  if (!isUuid(assetId)) return fail('That asset could not be found.', 404)

  const result = await calculateKpis(caller, assetId)
  if (!result.ok) return fail(result.error, result.status)
  revalidatePath(`/dashboard/assets/${result.assetId}`)
  revalidatePath('/dashboard')
  return json({ ok: true, message: describeKpiRuns(result.runs, result.problems), runs: result.runs.length })
}
