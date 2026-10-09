import { revalidatePath } from 'next/cache'
import { runAgent, type AgentTurn } from '@/lib/agent'
import { fail, getCaller, json, NOT_SIGNED_IN } from '@/lib/documentRequests'

// A turn that reads a document can take a few minutes.
export const maxDuration = 300

/** One turn of the chat with the Portfolio Analyst. The conversation so far comes from the browser; nothing is stored. */
export async function POST(request: Request) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const body = (await request.json().catch(() => null)) as { turns?: unknown; pageAssetId?: unknown; references?: unknown } | null
  if (!body || !Array.isArray(body.turns)) return fail('Type a message first.')

  const turns: AgentTurn[] = (body.turns as Record<string, unknown>[]).slice(-40).flatMap((turn) => {
    const role = turn?.role === 'assistant' ? 'assistant' : turn?.role === 'user' ? 'user' : null
    if (!role) return []
    const attachments = Array.isArray(turn.attachments)
      ? (turn.attachments as Record<string, unknown>[]).map((attachment) => ({ id: String(attachment?.id ?? ''), name: String(attachment?.name ?? '') }))
      : []
    return [{ role, text: String(turn.text ?? ''), attachments }]
  })
  const reply = await runAgent(caller, {
    turns,
    pageAssetId: typeof body.pageAssetId === 'string' ? body.pageAssetId : null,
    references: Array.isArray(body.references) ? body.references.map((reference) => String(reference)) : [],
  })
  if (!reply.ok) return fail(reply.error, 502)
  if (reply.changed) revalidatePath('/dashboard', 'layout')
  return json(reply)
}
