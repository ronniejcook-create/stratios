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
export type AgentAnswer = { ok: true; text: string; links: AgentLink[]; changed: boolean; pages?: AgentPages[] } | { ok: false; error: string }

/** Sends the conversation so far to the agent and returns its reply. A turn that reads a document can take a few minutes. */
export async function askAgent(input: { turns: AgentTurn[]; pageAssetId: string | null; references: string[] }): Promise<AgentAnswer> {
  const result = await call('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  if (!result.ok) return { ok: false, error: result.error ?? 'The agent could not answer. Try again.' }
  return { ok: true, text: String(result.text ?? ''), links: Array.isArray(result.links) ? (result.links as AgentLink[]) : [], changed: result.changed === true, pages: Array.isArray(result.pages) ? (result.pages as AgentPages[]) : [] }
}

/** Asks the agent to read an uploaded document. This can take a few minutes. */
export async function readUploadedDocument(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await call(`/api/documents/${id}/read`, { method: 'POST' })
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'The document could not be read.' }
}
