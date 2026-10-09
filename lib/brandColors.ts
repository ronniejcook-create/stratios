import { ApiError, askClaude } from './claude'
import { updateOrgSettings } from './orgSettings'
import { deriveTheme, normalizeHex, type BrandColors, type OrgTheme, type ThemeMode } from './theme'

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

export type BrandThemeResult =
  | { theme: OrgTheme; brand: BrandColors; note?: string; error?: undefined }
  | { theme: null; brand?: undefined; error: string }

const COLOR_RULES = `Return two colors as #rrggbb hex:
- primary: the organization's main signature brand color (it may be dark).
- accent: a vivid brand color that stands out clearly on a very dark background tinted with the primary color, for buttons and links. Use the brand's own bright or secondary color if it has one; otherwise a lighter, more vivid version of the primary.`

const COLOR_PROPERTIES = {
  primary: { type: 'string', description: 'Main brand color, #rrggbb' },
  accent: { type: 'string', description: 'Vivid brand color for buttons on dark backgrounds, #rrggbb' },
}

function readColors(answer: Record<string, unknown>): BrandColors | null {
  const primary = normalizeHex(answer.primary)
  const accent = normalizeHex(answer.accent)
  return primary && accent ? { primary, accent } : null
}

/**
 * Works out an organization's brand colors and builds its ten-color scheme.
 *
 * 1. By name: Claude is asked for the organization's official brand colors
 *    (its brand guidelines), using the domain only to tell organizations with
 *    similar names apart. If Claude knows them, they are used.
 * 2. By website (fallback): Stratios reads the colors used on the domain's
 *    home page and asks Claude to pick the brand colors from those.
 *
 * On failure returns a reason; the app then keeps the current colors.
 */
export async function generateBrandTheme(
  organization: { name: string; domain: string | null },
  mode: ThemeMode = 'dark',
): Promise<BrandThemeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim().replace(/^["']|["']$/g, '')
  if (!apiKey) return { theme: null, error: 'No Anthropic API key is set (ANTHROPIC_API_KEY).' }
  const { name } = organization
  const domain = organization.domain && DOMAIN.test(organization.domain) ? organization.domain : null

  try {
    // Step 1: the organization's brand guidelines, by name.
    const byName = await askClaude(
      apiKey,
      `What are the official brand colors of the organization "${name}"${domain ? ` (website: ${domain})` : ''}, as set out in its brand guidelines or visual identity?

Set "known" to true only if you are confident you know this specific organization's brand colors. If the name is ambiguous, generic, or you do not recognize the organization, set "known" to false and return #000000 for both colors.

${COLOR_RULES}`,
      {
        type: 'object',
        properties: { known: { type: 'boolean', description: 'True only if you confidently know this organization\'s brand colors' }, ...COLOR_PROPERTIES },
        required: ['known', 'primary', 'accent'],
        additionalProperties: false,
      },
    )
    const known = byName.known === true ? readColors(byName) : null
    if (known) {
      return {
        theme: deriveTheme(known.primary, known.accent, mode),
        brand: known,
        note: `Colors are based on ${name}'s brand guidelines.`,
      }
    }

    // Step 2: fall back to the colors used on the organization's website.
    if (!domain) {
      return { theme: null, error: `Claude does not know ${name}'s brand colors, and there is no company website to look at. Set the colors by hand.` }
    }
    const site = await readWebsite(domain)
    const websiteRead = site.title !== null || site.colors.length > 0
    if (!websiteRead) {
      return { theme: null, error: `Claude does not know ${name}'s brand colors, and ${domain} could not be read. Set the colors by hand.` }
    }
    const bySite = await askClaude(
      apiKey,
      `Pick the brand colors of the organization "${name}" from what we found on its website, https://${domain}:
- Page title: ${site.title ?? 'unknown'}
- theme-color meta tag: ${site.themeColor ?? 'none'}
- Most used colors (count in brackets): ${site.colors.length ? site.colors.join(', ') : 'none found'}

Ignore plain white, black and greys unless the brand is genuinely monochrome.

${COLOR_RULES}`,
      { type: 'object', properties: COLOR_PROPERTIES, required: ['primary', 'accent'], additionalProperties: false },
    )
    const fromSite = readColors(bySite)
    if (!fromSite) return { theme: null, error: 'Claude returned colors in an unexpected format.' }
    return {
      theme: deriveTheme(fromSite.primary, fromSite.accent, mode),
      brand: fromSite,
      note: `${name}'s brand guidelines weren't known, so the colors were picked from ${domain}.`,
    }
  } catch (error) {
    if (error instanceof ApiError) return { theme: null, error: error.message }
    console.error('Brand color generation failed', error)
    const errorName = error instanceof Error ? error.name : ''
    return {
      theme: null,
      error:
        errorName === 'TimeoutError' ? 'The Claude API took too long to answer; try again.' :
        errorName === 'SyntaxError' ? 'Claude returned colors in an unexpected format.' :
        'Stratios could not reach the Claude API from this computer.',
    }
  }
}


/**
 * Keeps the brand colors Stratios generated for an organization, separately
 * from the scheme in use, so they can be applied again later without another
 * lookup.
 */
export async function saveGeneratedBrand(organizationId: string, brand: BrandColors) {
  await updateOrgSettings(organizationId, { generatedBrand: { primary: brand.primary, accent: brand.accent } })
}

/** Saves (or with null, clears) an organization's graph colors. */
export async function saveChartColors(
  organizationId: string,
  value: { colors: string[]; source: 'history' | 'brand' | 'manual' | 'preset'; name?: string } | null,
) {
  await updateOrgSettings(organizationId, { chartColors: value })
}

/**
 * Saves (or with null, clears) an organization's color scheme, along with the
 * brand colors it was built from and its light/dark mode.
 */
export async function saveOrgTheme(
  organizationId: string,
  theme: OrgTheme | null,
  settings: { brand?: BrandColors | null; mode?: ThemeMode } = {},
) {
  const value = theme
    ? {
        ...theme,
        mode: settings.mode ?? 'dark',
        ...(settings.brand ? { brandPrimary: settings.brand.primary, brandAccent: settings.brand.accent } : {}),
      }
    : null
  await updateOrgSettings(organizationId, { theme: value })
}
