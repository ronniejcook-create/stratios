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

/** Counts the colours used in a chunk of HTML or CSS. */
function countColours(text: string, counts: Map<string, number>) {
  for (const match of text.matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const hex = normalizeHex(match[0])
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  for (const match of text.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/g)) {
    const hex = toHex(Number(match[1]), Number(match[2]), Number(match[3]))
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
}

/** Looks at the company's home page for its title, theme colour and most-used colours. */
async function readWebsite(domain: string) {
  const base = `https://${domain}`
  const html = (await fetchText(base, 600_000, 6000)) ?? (await fetchText(`https://www.${domain}`, 600_000, 6000))
  if (!html) return { title: null, themeColor: null, colours: [] as string[] }

  const title = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? null
  const themeColor = normalizeHex(html.match(/<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']+)["']/i)?.[1])

  const counts = new Map<string, number>()
  countColours(html, counts)

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
  for (const css of sheets) if (css) countColours(css, counts)

  const colours = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([hex, n]) => `${hex} (${n})`)
  return { title, themeColor, colours }
}

/**
 * Asks Claude for a ten-colour scheme that reflects the company behind
 * `domain`, using colours found on its website. Returns null if no API key is
 * configured or anything goes wrong; the app then keeps the Stratios colours.
 */
export async function generateBrandTheme(domain: string): Promise<OrgTheme | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY is not set; skipping brand colours')
    return null
  }
  if (!DOMAIN.test(domain)) return null

  const site = await readWebsite(domain)
  const roles = THEME_ROLES.map((r) => `- ${r.key}: ${r.label}`).join('\n')
  const prompt = `Choose a colour scheme for a web application used by the employees of the organization that owns the domain "${domain}". It should feel like their own brand.

What we found on https://${domain}:
- Page title: ${site.title ?? 'unknown'}
- theme-color meta tag: ${site.themeColor ?? 'none'}
- Most used colours (count in brackets): ${site.colours.length ? site.colours.join(', ') : 'none found'}

Return ten colours as #rrggbb hex for these roles:
${roles}

Rules:
- Base "accent" on the organization's main brand colour.
- Choose a light or dark background to suit the brand.
- "heading" and "text" must contrast with background, backgroundDeep and surface by at least 7:1; "mutedText" by at least 4.5:1.
- "accentText" must contrast with "accent" by at least 4.5:1.
- background, backgroundDeep and surface are close in lightness; border is subtle; borderStrong is clearly visible.
- If you cannot tell what the brand looks like, return a calm, professional scheme.`

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
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema } },
      }),
    })
    if (!response.ok) {
      console.error('Brand colour request failed', response.status, await response.text().catch(() => ''))
      return null
    }
    const data = (await response.json()) as { content?: { type: string; text?: string }[] }
    const text = data.content?.find((block) => block.type === 'text')?.text
    const theme = text ? parseTheme(JSON.parse(text)) : null
    return theme ? ensureReadable(theme) : null
  } catch (error) {
    console.error('Brand colour generation failed', error)
    return null
  }
}

/** Saves (or with null, clears) an organization's colour scheme. */
export async function saveOrgTheme(organizationId: string, theme: OrgTheme | null) {
  const client = await clerkClient()
  await client.organizations.updateOrganizationMetadata(organizationId, {
    publicMetadata: { theme: theme ? { ...theme } : null },
  })
}
