import { contrast, normalizeHex, type BrandColors, type ThemeMode } from './theme'

export const CHART_SLOTS = 10

/**
 * Default graph colors, one set per mode. Both orders were checked for
 * color-blind separation between neighbouring slices (including slice 10
 * next to slice 1 in a pie) and stay apart for normal vision too.
 */
export const DEFAULT_CHART_COLORS: Record<ThemeMode, string[]> = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948', '#0e8fa8', '#7c8a00'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767', '#1aa3bd', '#8f9e12'],
}

export type ChartColorSource = 'history' | 'brand' | 'manual'
export type StoredChartColors = { colors: string[]; source: ChartColorSource }

/** Reads stored graph colors, or null unless all ten are valid. */
export function parseChartColors(value: unknown): StoredChartColors | null {
  if (!value || typeof value !== 'object') return null
  const source = value as { colors?: unknown; source?: unknown }
  if (!Array.isArray(source.colors) || source.colors.length !== CHART_SLOTS) return null
  const colors = source.colors.map(normalizeHex)
  if (colors.some((c) => !c)) return null
  const kind = source.source === 'history' || source.source === 'manual' ? source.source : 'brand'
  return { colors: colors as string[], source: kind }
}

// --- OKLab, to measure how different two colors look ---
function toLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
function difference(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a)
  const [l2, a2, b2] = oklab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100
}
function chroma(hex: string): number {
  const [, a, b] = oklab(hex)
  return Math.hypot(a, b)
}

/**
 * Graph colors built from the brand when no past graph palette is known.
 * The brand accent (if colorful enough to be a series color) takes the place
 * of the default color closest to it, and the order is then rotated so the
 * accent comes first. Rotating keeps every pair of neighbouring colors the
 * same as in the checked default order (a pie is a circle), so the result
 * stays easy to tell apart.
 */
export function deriveChartColors(brand: BrandColors | null, mode: ThemeMode): string[] {
  const defaults = DEFAULT_CHART_COLORS[mode]
  const lead = brand && chroma(brand.accent) >= 0.08 ? brand.accent : null
  if (!lead) return [...defaults]
  let closest = 0
  defaults.forEach((c, i) => {
    if (difference(c, lead) < difference(defaults[closest], lead)) closest = i
  })
  const replaced = defaults.map((c, i) => (i === closest ? lead : c))
  return [...replaced.slice(closest), ...replaced.slice(0, closest)]
}

function mix(a: string, b: string, amount: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16)
  return '#' + [1, 3, 5].map((i) => Math.round(ch(a, i) * (1 - amount) + ch(b, i) * amount).toString(16).padStart(2, '0')).join('')
}

/**
 * Only colors that would all but vanish into the panel they are drawn on
 * (such as a navy brand color on a navy panel) are lightened or darkened.
 * Paler brand colors such as a bright yellow on white are kept as they are:
 * the charts carry a legend and gaps between slices, so they stay readable.
 */
const MIN_SURFACE_CONTRAST = 1.35

export function fitToSurface(colors: string[], surface: string): string[] {
  const towards = contrast('#ffffff', surface) > contrast('#000000', surface) ? '#ffffff' : '#000000'
  return colors.map((color) => {
    if (contrast(color, surface) >= MIN_SURFACE_CONTRAST) return color
    for (let amount = 0.1; amount <= 1; amount += 0.1) {
      const candidate = mix(color, towards, amount)
      if (contrast(candidate, surface) >= MIN_SURFACE_CONTRAST + 0.65) return candidate
    }
    return towards
  })
}

/** The graph colors to show: hand-picked ones exactly, others fitted to the panel color. */
export function displayChartColors(stored: StoredChartColors | null, brand: BrandColors | null, mode: ThemeMode, surface: string): string[] {
  if (stored?.source === 'manual') return stored.colors
  return fitToSurface(stored?.colors ?? deriveChartColors(brand, mode), surface)
}
