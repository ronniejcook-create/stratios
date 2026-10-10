// Saved conversations with the Portfolio Analyst (migration 033).
//
// A conversation belongs to one person in one organization. Every function
// takes the database client of a transaction scoped to the organization (see
// withOrg in lib/db.ts) and the person's id, and only ever touches that
// person's own conversations.

import { isUuid, type Queryable } from './records'

export type SavedAttachment = { id: string; name: string }
export type SavedLink = { label: string; href: string }
export type SavedMessage = { role: 'user' | 'assistant'; text: string; attachments: SavedAttachment[]; links: SavedLink[]; choices: string[] }
export type ConversationSummary = { id: string; title: string; updatedAt: string; messages: number }

const MAX_LISTED = 50
const MAX_MESSAGES = 400
const MAX_TEXT = 20000

/** Whether conversations can be saved (migration 033), without spoiling the transaction it runs in. */
export async function conversationsReady(client: Queryable): Promise<boolean> {
  const { rows } = await client.query(`select to_regclass('agent_conversations') is not null and to_regclass('agent_messages') is not null as ready`)
  return rows[0]?.ready === true
}

/** A title from the first thing the person said: its first line, cut short. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return 'New Chat'
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line
}

const list = (value: unknown): unknown[] => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  return Array.isArray(parsed) ? parsed : []
}

/** The person's conversations, the one used most recently first. */
export async function listConversations(client: Queryable, orgId: string, userId: string): Promise<ConversationSummary[]> {
  const { rows } = await client.query(
    `select c.id::text as id, c.title, to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at,
            (select count(*) from agent_messages m where m.conversation_id = c.id)::int as messages
     from agent_conversations c where c.org_id = $1 and c.user_id = $2 order by c.updated_at desc limit ${MAX_LISTED}`,
    [orgId, userId],
  )
  return rows.map((row) => ({ id: row.id as string, title: String(row.title), updatedAt: String(row.updated_at), messages: Number(row.messages) || 0 }))
}

/** One of the person's conversations with its messages in order, or null when it isn't theirs. */
export async function getConversation(client: Queryable, orgId: string, userId: string, id: string): Promise<{ id: string; title: string; messages: SavedMessage[] } | null> {
  if (!isUuid(id)) return null
  const found = await client.query('select id::text as id, title from agent_conversations where org_id = $1 and user_id = $2 and id = $3', [orgId, userId, id])
  if (found.rows.length === 0) return null
  const { rows } = await client.query(
    `select role, text, attachments, links, choices from agent_messages where org_id = $1 and conversation_id = $2 order by position limit ${MAX_MESSAGES}`,
    [orgId, id],
  )
  return {
    id,
    title: String(found.rows[0].title),
    messages: rows.map((row) => ({
      role: row.role === 'assistant' ? 'assistant' as const : 'user' as const,
      text: String(row.text),
      attachments: list(row.attachments).map((item) => ({ id: String((item as SavedAttachment)?.id ?? ''), name: String((item as SavedAttachment)?.name ?? '') })).filter((item) => isUuid(item.id)),
      links: list(row.links).map((item) => ({ label: String((item as SavedLink)?.label ?? ''), href: String((item as SavedLink)?.href ?? '') })).filter((item) => item.label && item.href.startsWith('/')),
      choices: list(row.choices).map(String).filter(Boolean),
    })),
  }
}

/**
 * Adds a message to a conversation, starting a new conversation when `id` is
 * null or is not one of the person's. Returns the conversation's id.
 */
export async function addMessage(client: Queryable, orgId: string, userId: string, id: string | null, message: Partial<SavedMessage> & Pick<SavedMessage, 'role' | 'text'>): Promise<string> {
  let conversationId: string | null = null
  if (id && isUuid(id)) {
    const owned = await client.query('select id::text as id from agent_conversations where org_id = $1 and user_id = $2 and id = $3 for update', [orgId, userId, id])
    conversationId = owned.rows[0]?.id ?? null
  }
  if (!conversationId) {
    const created = await client.query('insert into agent_conversations (org_id, user_id, title) values ($1, $2, $3) returning id::text as id', [orgId, userId, titleFrom(message.text)])
    conversationId = created.rows[0].id as string
  }
  await client.query(
    `insert into agent_messages (org_id, conversation_id, position, role, text, attachments, links, choices)
     select $1, $2::uuid, coalesce(max(position), 0) + 1, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb from agent_messages where conversation_id = $2::uuid`,
    [
      orgId, conversationId, message.role, message.text.slice(0, MAX_TEXT),
      JSON.stringify((message.attachments ?? []).slice(0, 5)), JSON.stringify((message.links ?? []).slice(0, 6)), JSON.stringify((message.choices ?? []).slice(0, 4)),
    ],
  )
  await client.query('update agent_conversations set updated_at = now() where org_id = $1 and id = $2', [orgId, conversationId])
  return conversationId
}

/** Deletes one of the person's conversations. True when there was one to delete. */
export async function deleteConversation(client: Queryable, orgId: string, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const { rows } = await client.query('delete from agent_conversations where org_id = $1 and user_id = $2 and id = $3 returning id', [orgId, userId, id])
  return rows.length > 0
}
