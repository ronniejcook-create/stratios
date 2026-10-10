import { revalidatePath } from 'next/cache'
import { runAgent, type AgentReply, type AgentTurn } from '@/lib/agent'
import { addMessage, conversationsReady } from '@/lib/conversations'
import { withOrg } from '@/lib/db'
import { fail, getCaller, NOT_SIGNED_IN, type Caller } from '@/lib/documentRequests'

// A turn that reads a document can take a few minutes.
export const maxDuration = 300

/** Saves one message of a conversation. Never throws: a chat that can't be saved still works (and nothing is saved before migration 033). */
async function keep(caller: Caller, conversationId: string | null, message: Parameters<typeof addMessage>[4]): Promise<string | null> {
  try {
    return await withOrg(caller.orgId, async (client) => ((await conversationsReady(client)) ? addMessage(client, caller.orgId, caller.userId, conversationId, message) : null))
  } catch (error) {
    console.error('Saving the conversation failed', error)
    return conversationId
  }
}

/**
 * One turn of the chat with the Portfolio Analyst. The conversation so far
 * comes from the browser. The answer is sent as it is written, one JSON
 * object per line: { type: 'text', piece }, { type: 'status', line },
 * { type: 'reset' }, and last { type: 'done', reply } or { type: 'error', error }.
 * The person's message and the reply are saved to the conversation.
 */
export async function POST(request: Request) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const body = (await request.json().catch(() => null)) as { turns?: unknown; pageAssetId?: unknown; references?: unknown; conversationId?: unknown } | null
  if (!body || !Array.isArray(body.turns)) return fail('Type a message first.')

  const turns: AgentTurn[] = (body.turns as Record<string, unknown>[]).slice(-40).flatMap((turn) => {
    const role = turn?.role === 'assistant' ? 'assistant' : turn?.role === 'user' ? 'user' : null
    if (!role) return []
    const attachments = Array.isArray(turn.attachments)
      ? (turn.attachments as Record<string, unknown>[]).map((attachment) => ({ id: String(attachment?.id ?? ''), name: String(attachment?.name ?? '') }))
      : []
    return [{ role, text: String(turn.text ?? ''), attachments }]
  })
  const last = turns[turns.length - 1]
  if (!last || last.role !== 'user') return fail('Type a message first.')

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const send = (event: object) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          open = false // the person closed the page; the work carries on and is still saved
        }
      }
      let conversationId = await keep(caller, typeof body.conversationId === 'string' ? body.conversationId : null, { role: 'user', text: last.text, attachments: last.attachments ?? [] })
      if (conversationId) send({ type: 'conversation', id: conversationId })
      let reply: AgentReply
      try {
        reply = await runAgent(
          caller,
          { turns, pageAssetId: typeof body.pageAssetId === 'string' ? body.pageAssetId : null, references: Array.isArray(body.references) ? body.references.map((reference) => String(reference)) : [] },
          { text: (piece) => send({ type: 'text', piece }), status: (line) => send({ type: 'status', line }), reset: () => send({ type: 'reset' }) },
        )
      } catch (error) {
        console.error('The agent failed', error)
        reply = { ok: false, error: 'The analyst could not answer. Try again.' }
      }
      if (reply.ok) {
        if (conversationId) conversationId = await keep(caller, conversationId, { role: 'assistant', text: reply.text, links: reply.links, choices: reply.choices ?? [] })
        if (reply.changed) {
          try {
            revalidatePath('/dashboard', 'layout')
          } catch (error) {
            console.error('Refreshing the pages failed', error)
          }
        }
        send({ type: 'done', reply, conversationId })
      } else {
        send({ type: 'error', error: reply.error, conversationId })
      }
      if (open) controller.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' } })
}
