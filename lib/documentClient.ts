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
export type AgentAnswer = { ok: true; text: string; links: AgentLink[]; changed: boolean; pages?: AgentPages[]; kpis?: string[]; statements?: AgentStatement[] } | { ok: false; error: string }

/** Sends the conversation so far to the agent and returns its reply. A turn that reads a document can take a few minutes. */
export async function askAgent(input: { turns: AgentTurn[]; pageAssetId: string | null; references: string[] }): Promise<AgentAnswer> {
  const result = await call('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  if (!result.ok) return { ok: false, error: result.error ?? 'The agent could not answer. Try again.' }
  return { ok: true, text: String(result.text ?? ''), links: Array.isArray(result.links) ? (result.links as AgentLink[]) : [], changed: result.changed === true, pages: Array.isArray(result.pages) ? (result.pages as AgentPages[]) : [], kpis: Array.isArray(result.kpis) ? result.kpis.map(String) : [], statements: Array.isArray(result.statements) ? (result.statements as AgentStatement[]) : [] }
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
