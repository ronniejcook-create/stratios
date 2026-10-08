import { DEFAULT_BRAND, contrast, normalizeHex, type BrandColors, type ThemeMode } from './theme'

export const CHART_SLOTS = 8

export type ChartColorSource = 'history' | 'brand' | 'manual'
export type StoredChartColors = { colors: string[]; source: ChartColorSource }

/** Reads stored graph colors (the first eight), or null unless they are all valid. */
export function parseChartColors(value: unknown): StoredChartColors | null {
  if (!value || typeof value !== 'object') return null
  const source = value as { colors?: unknown; source?: unknown }
  if (!Array.isArray(source.colors) || source.colors.length < CHART_SLOTS) return null
  const colors = source.colors.slice(0, CHART_SLOTS).map(normalizeHex)
  if (colors.some((c) => !c)) return null
  const kind = source.source === 'history' || source.source === 'manual' ? source.source : 'brand'
  return { colors: colors as string[], source: kind }
}

// --- Color math: OKLab / OKLCH, and color-blindness simulation ---

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => {
  const v = Math.max(0, Math.min(1, c))
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}
const linear = (hex: string) => [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255))

function labFromLinear([r, g, b]: number[]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function toLch(hex: string): [number, number, number] {
  const [L, a, b] = labFromLinear(linear(hex))
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]
}

/** OKLCH to hex, reducing chroma until the color fits on screen. */
function fromLch(L: number, C: number, H: number): string {
  for (let c = C; c >= 0; c -= 0.005) {
    const a = c * Math.cos((H * Math.PI) / 180)
    const b = c * Math.sin((H * Math.PI) / 180)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    const rgb = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) {
      return '#' + rgb.map((v) => Math.round(fromLinear(v) * 255).toString(16).padStart(2, '0')).join('')
    }
  }
  return '#808080'
}

// Machado, Oliveira & Fernandes (2009) color-blindness transforms, full severity, linear RGB.
const CVD: Record<string, number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
}

function difference(a: string, b: string, kind?: string): number {
  const view = (hex: string) => {
    const v = linear(hex)
    if (!kind) return v
    return CVD[kind].map((row) => Math.max(0, Math.min(1, row[0] * v[0] + row[1] * v[1] + row[2] * v[2])))
  }
  const x = labFromLinear(view(a))
  const y = labFromLinear(view(b))
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

/**
 * How well neighbouring colors can be told apart, including the last next to
 * the first (a pie is a circle). 1 or more means every neighbour pair clears
 * both floors: a difference of 15 for normal vision and 8 for color-blind vision.
 */
function separation(colors: string[]): number {
  let worst = Infinity
  colors.forEach((a, i) => {
    const b = colors[(i + 1) % colors.length]
    const normal = difference(a, b) / 15
    const colorBlind = Math.min(difference(a, b, 'protan'), difference(a, b, 'deutan'), difference(a, b, 'tritan')) / 8
    worst = Math.min(worst, normal, colorBlind)
  })
  return worst
}

const LIGHTNESS: Record<ThemeMode, number[][]> = {
  dark: [
    [0.64, 0.5, 0.6, 0.52, 0.66, 0.49, 0.62, 0.55],
    [0.5, 0.64, 0.53, 0.66, 0.49, 0.61, 0.56, 0.65],
    [0.58, 0.66, 0.49, 0.62, 0.52, 0.66, 0.5, 0.6],
    [0.66, 0.49, 0.62, 0.5, 0.66, 0.52, 0.6, 0.48],
    [0.49, 0.66, 0.52, 0.63, 0.48, 0.66, 0.55, 0.62],
  ],
  light: [
    [0.5, 0.7, 0.45, 0.66, 0.55, 0.74, 0.47, 0.63],
    [0.68, 0.48, 0.72, 0.52, 0.64, 0.45, 0.75, 0.56],
    [0.58, 0.45, 0.72, 0.52, 0.66, 0.47, 0.74, 0.55],
  ],
}
const ORDERS = [
  [0, 1, 2, 3, 4, 5, 6, 7],
  [0, 1, 3, 2, 5, 4, 7, 6],
  [0, 2, 1, 4, 3, 6, 5, 7],
]
const SPREADS = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90]

/**
 * Muted graph colors built from the organization's own colors, used when no
 * graph colors from its past reports are known. Hues start from the brand's
 * primary and accent colors and fan out around them, at low color strength.
 * Many arrangements are tried and the one whose neighbouring slices are
 * easiest to tell apart (including for color-blind viewers) is kept; color
 * strength is raised a little only if no muted arrangement separates well.
 */
export function deriveChartColors(brand: BrandColors | null, mode: ThemeMode): string[] {
  const { primary, accent } = brand ?? DEFAULT_BRAND
  const [, , primaryHue] = toLch(primary)
  const [, accentChroma, accentHue] = toLch(accent)
  const secondHue = accentChroma < 0.04 ? primaryHue + 180 : accentHue

  let best: string[] = []
  for (const strength of [0.105, 0.12, 0.14]) {
    let bestScore = -1
    for (const spread of SPREADS) {
      const hues = [primaryHue, secondHue, primaryHue + spread, secondHue + spread, primaryHue - spread, secondHue - spread, primaryHue + 2 * spread, secondHue + 2 * spread]
      for (const order of ORDERS) {
        for (const lightness of LIGHTNESS[mode]) {
          const colors = order.map((o, i) => fromLch(lightness[i], strength, (hues[o] + 360) % 360))
          const score = separation(colors)
          if (score > bestScore) {
            bestScore = score
            best = colors
          }
        }
      }
    }
    if (bestScore >= 1) break
  }
  return best
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
