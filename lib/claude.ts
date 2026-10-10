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

export class ApiError extends Error {
  /** The HTTP status Claude answered with, when the request got that far. */
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

/**
 * Whether Claude turned a request down because of the answer format itself
 * (it limits how large and how nested a required format may be), rather than
 * because of what was asked.
 */
function formatRefused(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400 && /schema|grammar|output_config|output format|too complex|compil/i.test(error.message)
}

/** The JSON object in a reply that may have a code fence or a stray sentence around it. */
function looseJson(text: string): Record<string, unknown> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new SyntaxError('No JSON object in the answer')
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
}

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
  const started = Date.now()
  try {
    return await askOnce(apiKey, content, schema, options, true)
  } catch (error) {
    if (!formatRefused(error)) throw error
    // Claude would not take the answer format as a requirement (too large for it). Ask again with the format
    // described in the question instead; the answer is checked by the caller either way.
    console.error('Claude refused the required answer format; asking again with the format in the question.', (error as Error).message)
    const described = `Answer with one JSON object and nothing else: no explanation and no code fence. It must match this JSON Schema exactly, with every required property present:\n${JSON.stringify(schema)}`
    const again = typeof content === 'string' ? `${content}\n\n${described}` : [...content, { type: 'text', text: described }]
    const left = options.timeoutMs === undefined ? undefined : Math.max(5000, options.timeoutMs - (Date.now() - started))
    return askOnce(apiKey, again, schema, { ...options, timeoutMs: left }, false)
  }
}

async function askOnce(
  apiKey: string,
  content: string | object[],
  schema: object,
  options: { maxTokens?: number; timeoutMs?: number },
  required: boolean,
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
      ...(required ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
    }),
  })
  if (!response.ok) {
    const error = describeApiError(response.status, await response.text().catch(() => ''))
    console.error('Claude request failed:', error)
    throw new ApiError(error, response.status)
  }
  const data = (await response.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string }
  if (data.stop_reason === 'max_tokens') throw new ApiError('Claude\'s answer was cut off because it was too long.')
  if (data.stop_reason === 'refusal') throw new ApiError('Claude declined to answer this request.')
  const text = data.content?.find((block) => block.type === 'text')?.text
  if (!text) throw new ApiError(`Claude returned no answer (stop reason: ${data.stop_reason ?? 'unknown'}).`)
  return required ? (JSON.parse(text) as Answer) : looseJson(text)
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
  input: { system: string; messages: ChatMessage[]; tools: ToolDefinition[]; maxTokens?: number; timeoutMs?: number; onText?: (piece: string) => void },
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
      ...(input.onText ? { stream: true } : {}),
    }),
  })
  if (!response.ok) {
    const error = describeApiError(response.status, await response.text().catch(() => ''))
    console.error('Claude request failed:', error)
    throw new ApiError(error)
  }
  if (input.onText && response.body) return readStream(response.body, input.onText)
  const data = (await response.json()) as { content?: ContentBlock[]; stop_reason?: string }
  return { content: Array.isArray(data.content) ? data.content : [], stopReason: data.stop_reason ?? 'unknown' }
}

/**
 * Reads Claude's answer as it is written (server-sent events), handing each
 * piece of text to `onText`, and returns the same shape as a whole answer.
 */
async function readStream(body: ReadableStream<Uint8Array>, onText: (piece: string) => void): Promise<{ content: ContentBlock[]; stopReason: string }> {
  type Building = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; json: string }
  const blocks: (Building | undefined)[] = []
  let stopReason = 'unknown'
  const handle = (data: string) => {
    let event: Record<string, any>
    try {
      event = JSON.parse(data)
    } catch {
      return
    }
    if (event.type === 'content_block_start') {
      const block = event.content_block ?? {}
      if (block.type === 'text') blocks[event.index] = { type: 'text', text: String(block.text ?? '') }
      else if (block.type === 'tool_use') blocks[event.index] = { type: 'tool_use', id: String(block.id), name: String(block.name), json: '' }
    } else if (event.type === 'content_block_delta') {
      const block = blocks[event.index]
      const delta = event.delta ?? {}
      if (block?.type === 'text' && delta.type === 'text_delta') {
        block.text += String(delta.text ?? '')
        if (delta.text) onText(String(delta.text))
      } else if (block?.type === 'tool_use' && delta.type === 'input_json_delta') {
        block.json += String(delta.partial_json ?? '')
      }
    } else if (event.type === 'message_delta') {
      if (event.delta?.stop_reason) stopReason = String(event.delta.stop_reason)
    } else if (event.type === 'error') {
      throw new ApiError(describeApiError(529, JSON.stringify(event)))
    }
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
    let cut = buffer.indexOf('\n')
    while (cut >= 0) {
      const line = buffer.slice(0, cut).replace(/\r$/, '')
      buffer = buffer.slice(cut + 1)
      if (line.startsWith('data:')) handle(line.slice(5).trim())
      cut = buffer.indexOf('\n')
    }
    if (done) break
  }
  if (buffer.startsWith('data:')) handle(buffer.slice(5).trim())
  const content: ContentBlock[] = []
  for (const block of blocks) {
    if (!block) continue
    if (block.type === 'text') content.push({ type: 'text', text: block.text })
    else {
      let parsed: Record<string, unknown> = {}
      try {
        parsed = block.json ? JSON.parse(block.json) : {}
      } catch {
        parsed = {}
      }
      content.push({ type: 'tool_use', id: block.id, name: block.name, input: parsed })
    }
  }
  return { content, stopReason }
}
