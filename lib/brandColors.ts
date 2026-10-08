import { clerkClient } from '@clerk/nextjs/server'
import { THEME_ROLES, ensureReadable, normalizeHex, parseTheme, type OrgTheme } from './theme'

const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

async function fetchText(url: string, maxBytes: number, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; StratiosBrandCheck/1.0)', accept: 'text/html,text/css,*/*' },
      redirect: 'follow',
    })
    if (!response.ok || !response.body) return null
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (size < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
    }
    await reader.cancel().catch(() => {})
    return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes))
  } catch {
    return null
  }
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')
}

/** Counts the colors used in a chunk of HTML or CSS. */
function countColors(text: string, counts: Map<string, number>) {
  for (const match of text.matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const hex = normalizeHex(match[0])
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  for (const match of text.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/g)) {
    const hex = toHex(Number(match[1]), Number(match[2]), Number(match[3]))
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
}

/** Looks at the company's home page for its title, theme color and most-used colors. */
async function readWebsite(domain: string) {
  const base = `https://${domain}`
  const html = (await fetchText(base, 600_000, 6000)) ?? (await fetchText(`https://www.${domain}`, 600_000, 6000))
  if (!html) return { title: null, themeColor: null, colors: [] as string[] }

  const title = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? null
  const themeColor = normalizeHex(html.match(/<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']+)["']/i)?.[1])

  const counts = new Map<string, number>()
  countColors(html, counts)

  // A few of the site's own stylesheets.
  const hrefs = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)].map((m) => m[1])
  const sameSite = hrefs
    .map((href) => {
      try {
        return new URL(href, base)
      } catch {
        return null
      }
    })
    .filter((url): url is URL => !!url && url.protocol === 'https:' && (url.hostname === domain || url.hostname.endsWith(`.${domain}`)))
    .slice(0, 3)
  const sheets = await Promise.all(sameSite.map((url) => fetchText(url.toString(), 400_000, 5000)))
  for (const css of sheets) if (css) countColors(css, counts)

  const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([hex, n]) => `${hex} (${n})`)
  return { title, themeColor, colors }
}

export type BrandThemeResult = { theme: OrgTheme; note?: string; error?: undefined } | { theme: null; error: string }

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

/**
 * Asks Claude for a ten-color scheme that reflects the company behind
 * `domain`, using colors found on its website. On failure returns a reason;
 * the app then keeps the current colors.
 */
export async function generateBrandTheme(domain: string): Promise<BrandThemeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim().replace(/^["']|["']$/g, '')
  if (!apiKey) return { theme: null, error: 'No Anthropic API key is set (ANTHROPIC_API_KEY).' }
  if (!DOMAIN.test(domain)) return { theme: null, error: `"${domain}" is not a website domain that can be looked up.` }

  const site = await readWebsite(domain)
  const roles = THEME_ROLES.map((r) => `- ${r.key}: ${r.label}`).join('\n')
  const websiteRead = site.title !== null || site.colors.length > 0
  const prompt = `Choose a color scheme for a web application used by the employees of the organization that owns the domain "${domain}". It must feel unmistakably like their own brand.

First, use what you know about this organization and its brand identity (logo, signature colors). Well-known companies have recognizable brand colors; use them.
${websiteRead ? `What we found on https://${domain} (use this to confirm or refine):
- Page title: ${site.title ?? 'unknown'}
- theme-color meta tag: ${site.themeColor ?? 'none'}
- Most used colors (count in brackets): ${site.colors.length ? site.colors.join(', ') : 'none found'}` : `Their website could not be read, so rely on what you know about the brand.`}

Return ten colors as #rrggbb hex for these roles:
${roles}

Rules:
- "accent" must be the organization's signature brand color, or a lighter or darker tint of it if needed for contrast, so it is instantly recognizable.
- Tint the backgrounds toward the brand (for example a deep brand-colored dark background, or a light background with brand-colored accents), not a generic grey or navy, unless the brand itself is grey or navy.
- "heading" and "text" must contrast with background, backgroundDeep and surface by at least 7:1; "mutedText" by at least 4.5:1; "accent" by at least 3:1.
- "accentText" must contrast with "accent" by at least 4.5:1.
- background, backgroundDeep and surface are close in lightness; border is subtle; borderStrong is clearly visible.
- Only if you genuinely do not know the organization and found no colors, return a calm, professional scheme.`

  const schema = {
    type: 'object',
    properties: Object.fromEntries(THEME_ROLES.map((r) => [r.key, { type: 'string', description: `${r.label}, as #rrggbb` }])),
    required: THEME_ROLES.map((r) => r.key),
    additionalProperties: false,
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema } },
      }),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      const error = describeApiError(response.status, body)
      console.error('Brand color request failed:', error)
      return { theme: null, error }
    }
    const data = (await response.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string }
    const text = data.content?.find((block) => block.type === 'text')?.text
    if (!text) return { theme: null, error: `Claude returned no colors (stop reason: ${data.stop_reason ?? 'unknown'}).` }
    const theme = parseTheme(JSON.parse(text))
    if (!theme) return { theme: null, error: 'Claude returned colors in an unexpected format.' }
    return {
      theme: ensureReadable(theme),
      note: websiteRead ? undefined : `${domain} could not be read (many large sites block automated visits), so the colors are based on what Claude knows about the brand.`,
    }
  } catch (error) {
    console.error('Brand color generation failed', error)
    const name = error instanceof Error ? error.name : ''
    return {
      theme: null,
      error:
        name === 'TimeoutError' ? 'The Claude API took too long to answer; try again.' :
        name === 'SyntaxError' ? 'Claude returned colors in an unexpected format.' :
        'Stratios could not reach the Claude API from this computer.',
    }
  }
}

/** Saves (or with null, clears) an organization's color scheme. */
export async function saveOrgTheme(organizationId: string, theme: OrgTheme | null) {
  const client = await clerkClient()
  await client.organizations.updateOrganizationMetadata(organizationId, {
    publicMetadata: { theme: theme ? { ...theme } : null },
  })
}
