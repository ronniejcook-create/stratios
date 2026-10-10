// Browser-side calls to the document API. No server code in here.

type Answer = { ok: boolean; error?: string } & Record<string, unknown>

async function call(url: string, init: RequestInit): Promise<Answer> {
  try {
    const response = await fetch(url, init)
    const body = (await response.json().catch(() => null)) as Answer | null
    if (body && typeof body.ok === 'boolean') return body
    return {
      ok: false,
      error:
        response.status === 413 ? 'That file is too large to upload.' :
        response.status === 504 ? 'Reading took too long and was stopped. Try again, or use a shorter document.' :
        `The server could not finish the request (code ${response.status}). Try again.`,
    }
  } catch {
    return { ok: false, error: 'The connection was lost. Check your internet and try again.' }
  }
}

/**
 * Uploads a file in pieces, reporting progress from 0 to 1. Resolves with the
 * new document's id. Pass null for the asset when the file is being handed to
 * the agent and has no asset yet.
 */
export async function uploadDocument(assetId: string | null, file: File, onProgress: (done: number) => void): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const started = await call('/api/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assetId, name: file.name, size: file.size, type: file.type }),
  })
  if (!started.ok) return { ok: false, error: started.error ?? 'The upload could not be started.' }
  const id = String(started.id)
  const chunkBytes = Number(started.chunkBytes)
  const chunkCount = Number(started.chunkCount)

  for (let index = 0; index < chunkCount; index += 1) {
    const piece = file.slice(index * chunkBytes, (index + 1) * chunkBytes)
    const send = () => call(`/api/documents/${id}/chunks/${index}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: piece })
    let sent = await send()
    if (!sent.ok) sent = await send() // one retry covers a brief network hiccup
    if (!sent.ok) return { ok: false, error: sent.error ?? 'Part of the file could not be uploaded.' }
    onProgress((index + 1) / chunkCount)
  }

  const finished = await call(`/api/documents/${id}/complete`, { method: 'POST' })
  return finished.ok ? { ok: true, id } : { ok: false, error: finished.error ?? 'The upload could not be finished.' }
}

export type AgentTurn = { role: 'user' | 'assistant'; text: string; attachments?: { id: string; name: string }[] }
export type AgentLink = { label: string; href: string }
export type AgentPages = { assetId: string; documentId: string; pages: { page: number; caption: string | null }[] }
/** A document whose operating statement is to be copied as a cash flow once the agent has answered. */
export type AgentStatement = { assetId: string; documentId: string }
export type AgentAnswer = { ok: true; text: string; links: AgentLink[]; changed: boolean; pages?: AgentPages[]; kpis?: string[]; statements?: AgentStatement[]; choices?: string[] } | { ok: false; error: string }

/** What the panel is told while a reply is being written. */
export type AgentProgress = {
  /** A piece of the reply's text. */
  onText?: (piece: string) => void
  /** A line saying what the analyst is doing, such as "Opening the rent roll…". */
  onStatus?: (line: string) => void
  /** The text so far was not the reply (the analyst went on to look something up); start over. */
  onReset?: () => void
  /** The saved conversation this turn belongs to. */
  onConversation?: (id: string) => void
}

const asAnswer = (result: Record<string, unknown>): AgentAnswer => ({
  ok: true,
  text: String(result.text ?? ''),
  links: Array.isArray(result.links) ? (result.links as AgentLink[]) : [],
  changed: result.changed === true,
  pages: Array.isArray(result.pages) ? (result.pages as AgentPages[]) : [],
  kpis: Array.isArray(result.kpis) ? result.kpis.map(String) : [],
  statements: Array.isArray(result.statements) ? (result.statements as AgentStatement[]) : [],
  choices: Array.isArray(result.choices) ? result.choices.map(String).slice(0, 4) : [],
})

/**
 * Sends the conversation so far to the agent and returns its reply. The reply
 * arrives as it is written, one JSON object per line; `progress` is told
 * about each piece. A turn that reads a document can take a few minutes.
 */
export async function askAgent(input: { turns: AgentTurn[]; pageAssetId: string | null; references: string[]; conversationId?: string | null }, progress: AgentProgress = {}): Promise<AgentAnswer> {
  const LOST = 'The connection was lost. Check your internet and try again.'
  let response: Response
  try {
    response = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  } catch {
    return { ok: false, error: LOST }
  }
  // A refusal before the reply starts (not signed in, nothing typed) is plain JSON.
  if (!response.ok || !response.body || !(response.headers.get('content-type') ?? '').includes('ndjson')) {
    const body = (await response.json().catch(() => null)) as Answer | null
    if (body && body.ok === true) return asAnswer(body)
    return { ok: false, error: body?.error ?? (response.status === 504 ? 'The analyst took too long and was stopped. Try again.' : `The analyst could not answer (code ${response.status}). Try again.`) }
  }
  let answer: AgentAnswer | null = null
  const handle = (line: string) => {
    if (!line.trim()) return
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (event.type === 'text') progress.onText?.(String(event.piece ?? ''))
    else if (event.type === 'status') progress.onStatus?.(String(event.line ?? ''))
    else if (event.type === 'reset') progress.onReset?.()
    else if (event.type === 'conversation') progress.onConversation?.(String(event.id ?? ''))
    else if (event.type === 'done') answer = asAnswer((event.reply ?? {}) as Record<string, unknown>)
    else if (event.type === 'error') answer = { ok: false, error: String(event.error ?? 'The analyst could not answer. Try again.') }
  }
  try {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
      let cut = buffer.indexOf('\n')
      while (cut >= 0) {
        handle(buffer.slice(0, cut))
        buffer = buffer.slice(cut + 1)
        cut = buffer.indexOf('\n')
      }
      if (done) break
    }
    handle(buffer)
  } catch {
    return answer ?? { ok: false, error: LOST }
  }
  return answer ?? { ok: false, error: 'The analyst stopped before it finished, most likely because it ran out of time. Try again.' }
}

export type ChatSummary = { id: string; title: string; updatedAt: string; messages: number }
export type ChatMessage = { role: 'user' | 'assistant'; text: string; attachments: { id: string; name: string }[]; links: AgentLink[]; choices: string[] }

/** The person's saved chats, latest first. `ready` is false while the database has not been updated to save chats. */
export async function listChats(): Promise<{ ready: boolean; chats: ChatSummary[] }> {
  const result = await call('/api/agent/conversations', { method: 'GET' })
  return { ready: result.ok && result.ready === true, chats: result.ok && Array.isArray(result.conversations) ? (result.conversations as ChatSummary[]) : [] }
}

/** One saved chat's messages, or null when it can't be opened. */
export async function openChat(id: string): Promise<ChatMessage[] | null> {
  const result = await call(`/api/agent/conversations/${encodeURIComponent(id)}`, { method: 'GET' })
  const conversation = result.ok ? (result.conversation as { messages?: ChatMessage[] } | undefined) : undefined
  return conversation && Array.isArray(conversation.messages) ? conversation.messages : null
}

export async function deleteChat(id: string): Promise<boolean> {
  return (await call(`/api/agent/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })).ok
}

/** Asks the agent to read an uploaded document. This can take a few minutes. */
export async function readUploadedDocument(id: string): Promise<{ ok: true; rentRollRows: number; operatingStatement: boolean } | { ok: false; error: string }> {
  const result = await call(`/api/documents/${id}/read`, { method: 'POST' })
  return result.ok ? { ok: true, rentRollRows: Number(result.rentRollRows) || 0, operatingStatement: result.operatingStatement === true } : { ok: false, error: result.error ?? 'The document could not be read.' }
}

/**
 * Copies the operating statement in a document that has been read, line by
 * line, and saves it as a cash flow on its asset. Takes a minute or two.
 */
export async function loadCashFlow(documentId: string): Promise<{ ok: true; found: boolean; cashFlowId: string | null; message: string } | { ok: false; error: string }> {
  const result = await call('/api/cash-flow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId }) })
  if (!result.ok) return { ok: false, error: result.error ?? 'The statement could not be copied. Try again.' }
  return { ok: true, found: result.found === true, cashFlowId: typeof result.cashFlowId === 'string' ? result.cashFlowId : null, message: String(result.message ?? 'The statement was saved.') }
}

/** Asks the agent to read an uploaded lease agreement or amendment into one lease. This can take a few minutes. */
export async function readLeaseDocument(leaseId: string, documentId: string): Promise<{ ok: true; assetId: string; filled: number; replaced: number; decisions: number; listRows: number } | { ok: false; error: string }> {
  const result = await call(`/api/leases/${leaseId}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId }) })
  if (!result.ok) return { ok: false, error: result.error ?? 'The document could not be read.' }
  const counts = (result.counts ?? {}) as Record<string, number>
  return { ok: true, assetId: String(result.assetId), filled: Number(counts.filled) || 0, replaced: Number(counts.replaced) || 0, decisions: Number(counts.decision) || 0, listRows: Number(result.listRows) || 0 }
}

/**
 * Calculates an asset's KPIs from its stored leases, following the KPI skill
 * for each property's kind. Takes up to a minute or two per property.
 */
export async function recalculateKpis(assetId: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const result = await call('/api/kpis', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId }) })
  return result.ok ? { ok: true, message: String(result.message ?? 'The KPIs were calculated.') } : { ok: false, error: result.error ?? 'The KPIs could not be calculated. Try again.' }
}

/** The file picker's filter: PDFs and Excel workbooks. */
export const DOCUMENT_ACCEPT = 'application/pdf,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,.xlsm'

/** Whether a chosen file is one that can be uploaded: a PDF or an Excel workbook (.xlsx). The server checks again. */
export function canUpload(file: { name: string; type: string }): boolean {
  return /\.(pdf|xlsx|xlsm)$/i.test(file.name) || file.type === 'application/pdf' || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}
export const CANNOT_UPLOAD = 'Only PDF files and Excel workbooks (.xlsx) can be read. Save an older .xls file as .xlsx first.'
