// The one place Stratios calls the Claude API. Server-side only: it reads the API key from the environment.

/** The Anthropic API key from the environment, or null when none is set. */
export function claudeApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim().replace(/^["']|["']$/g, '') || null
}

/** Turns an Anthropic API error response into a short, readable reason (never includes the key). */
function describeApiError(status: number, body: string): string {
  let detail = ''
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string; message?: string } }
    detail = [parsed.error?.type, parsed.error?.message].filter(Boolean).join(': ')
  } catch {
    detail = body.slice(0, 200)
  }
  const hint =
    status === 401 ? 'The API key was not accepted. Check it was pasted in full, with no spaces or quotes.' :
    status === 402 || /credit balance/i.test(detail) ? 'The API account has no credit available.' :
    status === 403 ? 'The API key does not have permission for this request.' :
    status === 404 ? 'The AI model was not found for this account.' :
    status === 413 ? 'The request was too large for Claude to read.' :
    status === 429 ? 'Too many requests; wait a minute and try again.' :
    status >= 500 ? 'The Claude API had a temporary problem; try again shortly.' :
    'The Claude API rejected the request.'
  return `${hint} (HTTP ${status}${detail ? `, ${detail}` : ''})`.slice(0, 400)
}

export class ApiError extends Error {}

type Answer = Record<string, unknown>

/**
 * Sends one message to Claude and returns its JSON answer, shaped by `schema`.
 * `content` is the message: plain text, or a list of content blocks (for
 * example a PDF followed by the question about it).
 */
export async function askClaudeWith(
  apiKey: string,
  content: string | object[],
  schema: object,
  options: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<Answer> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Only needed for API keys that are not tied to a workspace.
      ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID.trim() } : {}),
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: options.maxTokens ?? 512,
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema } },
    }),
  })
  if (!response.ok) {
    const error = describeApiError(response.status, await response.text().catch(() => ''))
    console.error('Claude request failed:', error)
    throw new ApiError(error)
  }
  const data = (await response.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string }
  if (data.stop_reason === 'max_tokens') throw new ApiError('Claude\'s answer was cut off because it was too long.')
  if (data.stop_reason === 'refusal') throw new ApiError('Claude declined to answer this request.')
  const text = data.content?.find((block) => block.type === 'text')?.text
  if (!text) throw new ApiError(`Claude returned no answer (stop reason: ${data.stop_reason ?? 'unknown'}).`)
  return JSON.parse(text) as Answer
}

/** Sends one prompt to Claude and returns its JSON answer, shaped by `schema`. */
export async function askClaude(apiKey: string, prompt: string, schema: object): Promise<Answer> {
  return askClaudeWith(apiKey, prompt, schema)
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
export type ChatMessage = { role: 'user' | 'assistant'; content: string | ContentBlock[] }
export type ToolDefinition = { name: string; description: string; input_schema: object }

/**
 * One step of a conversation in which Claude may ask to use tools. Returns
 * what Claude said and any tools it wants run; the caller runs them and calls
 * again with the results (see lib/agent.ts).
 */
export async function converse(
  apiKey: string,
  input: { system: string; messages: ChatMessage[]; tools: ToolDefinition[]; maxTokens?: number; timeoutMs?: number },
): Promise<{ content: ContentBlock[]; stopReason: string }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(input.timeoutMs ?? 60000),
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID.trim() } : {}),
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: input.maxTokens ?? 2000,
      system: input.system,
      messages: input.messages,
      tools: input.tools,
    }),
  })
  if (!response.ok) {
    const error = describeApiError(response.status, await response.text().catch(() => ''))
    console.error('Claude request failed:', error)
    throw new ApiError(error)
  }
  const data = (await response.json()) as { content?: ContentBlock[]; stop_reason?: string }
  return { content: Array.isArray(data.content) ? data.content : [], stopReason: data.stop_reason ?? 'unknown' }
}
