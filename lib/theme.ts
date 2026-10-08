import type { CSSProperties } from 'react'

/** The ten colors that make up an organization's scheme, and the CSS variables each one drives. */
export const THEME_ROLES = [
  { key: 'background', label: 'Page background', vars: ['--bg'] },
  { key: 'backgroundDeep', label: 'Deep background', vars: ['--bg-deep'] },
  { key: 'surface', label: 'Panels and cards', vars: ['--panel'] },
  { key: 'border', label: 'Dividers', vars: ['--line'] },
  { key: 'borderStrong', label: 'Input and button borders', vars: ['--line-strong'] },
  { key: 'heading', label: 'Headings', vars: ['--heading'] },
  { key: 'text', label: 'Body text', vars: ['--text'] },
  { key: 'mutedText', label: 'Secondary text', vars: ['--muted', '--dim'] },
  { key: 'accent', label: 'Accent (buttons, links)', vars: ['--accent'] },
  { key: 'accentText', label: 'Text on accent', vars: ['--accent-ink'] },
] as const

export type ThemeRole = (typeof THEME_ROLES)[number]['key']
export type OrgTheme = Record<ThemeRole, string>

export const DEFAULT_THEME: OrgTheme = {
  background: '#0f1d31',
  backgroundDeep: '#0c1829',
  surface: '#14253c',
  border: '#263750',
  borderStrong: '#5b6c85',
  heading: '#ffffff',
  text: '#e6edf7',
  mutedText: '#b9c6d9',
  accent: '#2ccbe8',
  accentText: '#06202b',
}

const HEX = /^#[0-9a-f]{6}$/

export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let hex = value.trim().toLowerCase()
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = '#' + [...hex.slice(1)].map((c) => c + c).join('')
  return HEX.test(hex) ? hex : null
}

/** Reads a stored theme, returning null unless every role holds a valid color. */
export function parseTheme(value: unknown): OrgTheme | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const theme = {} as OrgTheme
  for (const { key } of THEME_ROLES) {
    const hex = normalizeHex(source[key])
    if (!hex) return null
    theme[key] = hex
  }
  return theme
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const isDark = (hex: string) => luminance(hex) < 0.2

function mix(a: string, b: string, amount: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16)
  return '#' + [1, 3, 5].map((i) => Math.round(channel(a, i) * (1 - amount) + channel(b, i) * amount).toString(16).padStart(2, '0')).join('')
}

/** Lightens or darkens a color step by step (keeping its hue) until `ok` passes. */
function shiftUntil(color: string, toward: string, ok: (c: string) => boolean): string {
  for (let amount = 0.1; amount <= 1; amount += 0.1) {
    const candidate = mix(color, toward, amount)
    if (ok(candidate)) return candidate
  }
  return toward
}

/** Black-ish or white, whichever reads better on `background`. */
function readableOn(background: string): string {
  return contrast('#ffffff', background) >= contrast('#0b1220', background) ? '#ffffff' : '#0b1220'
}

/**
 * Keeps text legible whatever colors were chosen: any text color that falls
 * below WCAG AA contrast against the backgrounds it sits on is replaced.
 */
export function ensureReadable(input: OrgTheme): OrgTheme {
  const theme = { ...input }
  const backgrounds = [theme.background, theme.backgroundDeep, theme.surface]
  const worst = (color: string) => Math.min(...backgrounds.map((bg) => contrast(color, bg)))

  if (worst(theme.heading) < 7) theme.heading = readableOn(theme.surface)
  if (worst(theme.text) < 4.5) theme.text = theme.heading
  if (worst(theme.mutedText) < 4.5) theme.mutedText = theme.text
  if (worst(theme.accent) < 3) theme.accent = shiftUntil(theme.accent, isDark(theme.surface) ? '#ffffff' : '#000000', (c) => worst(c) >= 3)
  if (contrast(theme.accentText, theme.accent) < 4.5) theme.accentText = readableOn(theme.accent)
  if (worst(theme.borderStrong) < 3) theme.borderStrong = shiftUntil(theme.borderStrong, isDark(theme.surface) ? '#ffffff' : '#000000', (c) => worst(c) >= 3)
  return theme
}

/** CSS custom properties for a theme, applied on the signed-in app's wrapper. */
export function themeToStyle(theme: OrgTheme): CSSProperties {
  const style: Record<string, string> = {}
  for (const role of THEME_ROLES) for (const name of role.vars) style[name] = theme[role.key]
  const dark = isDark(theme.background)
  style['--danger'] = dark ? '#ff9d8a' : '#b42318'
  style['--success'] = dark ? '#8fe3b0' : '#146c3a'
  return style as CSSProperties
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return [h, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return '#' + [0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, '0')).join('')
}

export type ThemeMode = 'dark' | 'light'
export type BrandColors = { primary: string; accent: string }

/** The Stratios brand itself, used when an organization has no brand colors of its own. */
export const DEFAULT_BRAND: BrandColors = { primary: '#0f1d31', accent: '#2ccbe8' }

/** Reads the brand colors and light/dark mode stored alongside a scheme. */
export function parseBrandSettings(value: unknown): { brand: BrandColors | null; mode: ThemeMode } {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const primary = normalizeHex(source.brandPrimary)
  const accent = normalizeHex(source.brandAccent)
  return { brand: primary && accent ? { primary, accent } : null, mode: source.mode === 'light' ? 'light' : 'dark' }
}

/**
 * Builds a full scheme in the Stratios style from an organization's two brand
 * colors: `primary` sets the hue of the backgrounds and text, `accent` becomes
 * the buttons and links. Dark mode uses deep backgrounds with light text (the
 * Stratios look); light mode uses pale backgrounds with dark text. Saturation
 * and lightness are fixed, so every organization gets the same structure,
 * tinted to its brand.
 */
export function deriveTheme(primary: string, accent: string, mode: ThemeMode = 'dark'): OrgTheme {
  const [hue, brandSat] = hexToHsl(primary)
  // Neutral brands (grey, black) stay neutral; colorful ones are tinted.
  const sat = (target: number) => Math.min(target, brandSat < 0.12 ? brandSat : target)

  if (mode === 'light') {
    const background = hslToHex(hue, sat(0.3), 0.965)
    // Prefer the brand color that already stands out on white.
    const pick = [accent, primary].find((c) => contrast(c, '#ffffff') >= 3 && contrast(c, background) >= 3) ?? accent
    return ensureReadable({
      background,
      backgroundDeep: hslToHex(hue, sat(0.3), 0.92),
      surface: '#ffffff',
      border: hslToHex(hue, sat(0.2), 0.87),
      borderStrong: hslToHex(hue, sat(0.15), 0.62),
      heading: hslToHex(hue, sat(0.6), 0.13),
      text: hslToHex(hue, sat(0.35), 0.2),
      mutedText: hslToHex(hue, sat(0.18), 0.38),
      accent: pick,
      accentText: '#ffffff',
    })
  }

  return ensureReadable({
    background: hslToHex(hue, sat(0.53), 0.125),
    backgroundDeep: hslToHex(hue, sat(0.55), 0.09),
    surface: hslToHex(hue, sat(0.5), 0.16),
    border: hslToHex(hue, sat(0.36), 0.23),
    borderStrong: hslToHex(hue, sat(0.19), 0.44),
    heading: '#ffffff',
    text: hslToHex(hue, sat(0.52), 0.935),
    mutedText: hslToHex(hue, sat(0.3), 0.79),
    accent,
    accentText: '#ffffff',
  })
}
