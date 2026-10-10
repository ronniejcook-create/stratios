import { conversationsReady, listConversations } from '@/lib/conversations'
import { withOrg } from '@/lib/db'
import { fail, getCaller, json, NOT_SIGNED_IN } from '@/lib/documentRequests'

/** The signed-in person's saved conversations with the analyst, the latest first. */
export async function GET() {
  const caller = await getCaller()
  if (!caller) return fail(NOT_SIGNED_IN, 401)
  try {
    const conversations = await withOrg(caller.orgId, async (client) => ((await conversationsReady(client)) ? listConversations(client, caller.orgId, caller.userId) : null))
    return json({ ok: true, ready: conversations !== null, conversations: conversations ?? [] })
  } catch (error) {
    console.error('Listing conversations failed', error)
    return fail('The chats could not be listed.', 500)
  }
}
