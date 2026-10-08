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
  if (worst(theme.borderStrong) < 3) theme.borderStrong = theme.mutedText
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
