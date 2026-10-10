import { conversationsReady, deleteConversation, getConversation } from '@/lib/conversations'
import { withOrg } from '@/lib/db'
import { fail, getCaller, json, NOT_SIGNED_IN } from '@/lib/documentRequests'

/** One of the signed-in person's conversations, with its messages. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const { id } = await params
  try {
    const conversation = await withOrg(caller.orgId, async (client) => ((await conversationsReady(client)) ? getConversation(client, caller.orgId, caller.userId, id) : null))
    return conversation ? json({ ok: true, conversation }) : fail('That chat could not be found.', 404)
  } catch (error) {
    console.error('Opening a conversation failed', error)
    return fail('The chat could not be opened.', 500)
  }
}

/** Deletes one of the signed-in person's conversations. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  const { id } = await params
  try {
    const gone = await withOrg(caller.orgId, async (client) => ((await conversationsReady(client)) ? deleteConversation(client, caller.orgId, caller.userId, id) : false))
    return gone ? json({ ok: true }) : fail('That chat could not be found.', 404)
  } catch (error) {
    console.error('Deleting a conversation failed', error)
    return fail('The chat could not be deleted.', 500)
  }
}
