import { revalidatePath } from 'next/cache'
import { fail, getCaller, json, NOT_SIGNED_IN } from '@/lib/documentRequests'
import { readIntoAsset } from '@/lib/documentReading'
import { isUuid } from '@/lib/records'

// Reading a long document can take a few minutes.
export const maxDuration = 300

/**
 * Has the extraction agent read a document that belongs to an asset and
 * applies each field's rules to what it finds (see lib/documentReading.ts).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const { id } = await params
  if (!isUuid(id)) return fail('That document could not be found.', 404)

  const result = await readIntoAsset(caller, id)
  if (!result.ok) return fail(result.error, result.status)
  revalidatePath(`/dashboard/assets/${result.assetId}`)
  revalidatePath('/dashboard')
  return json({ ok: true, counts: result.counts, proposals: result.proposals, skipped: result.skipped, listRows: result.listRows, addresses: result.addresses })
}
