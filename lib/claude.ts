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
    status === 429 ? 'Too many requests; wait a minute and try again.' :
    status >= 500 ? 'The Claude API had a temporary problem; try again shortly.' :
    'The Claude API rejected the request.'
  return `${hint} (HTTP ${status}${detail ? `, ${detail}` : ''})`.slice(0, 400)
}

export class ApiError extends Error {}

/** Sends one prompt to Claude and returns its JSON answer, shaped by `schema`. */
export async function askClaude(apiKey: string, prompt: string, schema: object): Promise<Record<string, unknown>> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Only needed for API keys that are not tied to a workspace.
      ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID.trim() } : {}),
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema } },
    }),
  })
  if (!response.ok) {
    const error = describeApiError(response.status, await response.text().catch(() => ''))
    console.error('Claude request failed:', error)
    throw new ApiError(error)
  }
  const data = (await response.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string }
  const text = data.content?.find((block) => block.type === 'text')?.text
  if (!text) throw new ApiError(`Claude returned no answer (stop reason: ${data.stop_reason ?? 'unknown'}).`)
  return JSON.parse(text) as Record<string, unknown>
}
