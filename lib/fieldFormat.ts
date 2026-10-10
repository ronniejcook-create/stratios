// Shared, browser-safe helpers for showing and reading field values.
// No database code in here, so both server and client components can use it.

export type DataType = 'text' | 'number' | 'money' | 'percent' | 'date' | 'boolean' | 'picklist'

export type FieldShape = {
  dataType: DataType
  unit: string | null
  /** A pick list's choices that can be picked now. */
  options: string[] | null
  /** Choices no longer offered; a record that holds one keeps it. */
  retiredOptions?: string[] | null
  /** Names a choice used to have, in lower case, with its name now. A stored old name is shown, and saved, as the current one. */
  optionAliases?: Record<string, string> | null
}

/** One stored value. Only the part that matches the field's type is filled. */
export type StoredValue = {
  text: string | null
  number: number | null
  date: string | null // YYYY-MM-DD
  bool: boolean | null
}

export const EMPTY_VALUE: StoredValue = { text: null, number: null, date: null, bool: null }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function isEmptyValue(value: StoredValue | null | undefined): boolean {
  if (!value) return true
  return value.text === null && value.number === null && value.date === null && value.bool === null
}

export function sameValue(a: StoredValue, b: StoredValue): boolean {
  return a.text === b.text && a.number === b.number && a.date === b.date && a.bool === b.bool
}

/** "2026-03-01" -> "Mar 2026" */
export function formatPeriod(period: string | null): string {
  if (!period) return ''
  const [year, month] = period.split('-')
  const name = MONTHS[Number(month) - 1]
  return name ? `${name} ${year}` : period
}

/** "2026-03-14" -> "Mar 14, 2026" */
export function formatDate(date: string): string {
  const [year, month, day] = date.split('-')
  const name = MONTHS[Number(month) - 1]
  return name ? `${name} ${Number(day)}, ${year}` : date
}

function formatNumber(value: number, maxDecimals: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: maxDecimals })
}

/** The value as shown on screen, or an empty string when there is none. */
export function formatValue(field: FieldShape, value: StoredValue | null | undefined): string {
  if (!value || isEmptyValue(value)) return ''
  switch (field.dataType) {
    case 'money': {
      if (value.number === null) return ''
      const perUnit = field.unit && field.unit.includes(' per ') ? ` ${field.unit.slice(field.unit.indexOf('per '))}` : ''
      const decimals = perUnit || !Number.isInteger(value.number) ? 2 : 0
      return `$${value.number.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${perUnit}`
    }
    case 'percent':
      return value.number === null ? '' : `${formatNumber(value.number, 2)}%`
    case 'number': {
      if (value.number === null) return ''
      // Years and counts read better without thousands separators when small.
      const text = field.unit || value.number >= 10000 || !Number.isInteger(value.number) ? formatNumber(value.number, 2) : String(value.number)
      return field.unit ? (field.unit === 'x' ? `${text}x` : `${text} ${field.unit}`) : text
    }
    case 'date':
      return value.date ? formatDate(value.date) : ''
    case 'boolean':
      return value.bool === null ? '' : value.bool ? 'Yes' : 'No'
    case 'picklist':
      return value.text === null ? '' : field.optionAliases?.[value.text.trim().toLowerCase()] ?? value.text
    default:
      return value.text ?? ''
  }
}

/** The value as it should appear in an edit box. */
export function editText(field: FieldShape, value: StoredValue | null | undefined): string {
  if (!value || isEmptyValue(value)) return ''
  switch (field.dataType) {
    case 'money':
    case 'percent':
    case 'number':
      return value.number === null ? '' : String(value.number)
    case 'date':
      return value.date ?? ''
    case 'boolean':
      return value.bool === null ? '' : value.bool ? 'yes' : 'no'
    case 'picklist':
      return value.text === null ? '' : field.optionAliases?.[value.text.trim().toLowerCase()] ?? value.text
    default:
      return value.text ?? ''
  }
}

export type ParseResult = { ok: true; value: StoredValue } | { ok: false; error: string }

/**
 * Turns what a person typed into a stored value for this field's type.
 * An empty entry clears the value.
 */
export function parseInput(field: FieldShape, raw: string): ParseResult {
  const text = raw.trim()
  if (!text) return { ok: true, value: { ...EMPTY_VALUE } }
  switch (field.dataType) {
    case 'money':
    case 'percent':
    case 'number': {
      // Accept "$1,250,000", "52,000 SF" and "5.25%".
      const cleaned = text.replace(/[$,%\s]/g, '').replace(/[a-zA-Z]+$/, '')
      if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { ok: false, error: 'Enter a number, for example 52000 or 5.25.' }
      const number = Number(cleaned)
      if (!Number.isFinite(number) || Math.abs(number) > 1e15) return { ok: false, error: 'That number is out of range.' }
      return { ok: true, value: { ...EMPTY_VALUE, number } }
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, error: 'Choose a date.' }
      const parsed = new Date(`${text}T00:00:00Z`)
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return { ok: false, error: 'That is not a real date.' }
      return { ok: true, value: { ...EMPTY_VALUE, date: text } }
    }
    case 'boolean': {
      const lower = text.toLowerCase()
      if (lower === 'yes' || lower === 'true') return { ok: true, value: { ...EMPTY_VALUE, bool: true } }
      if (lower === 'no' || lower === 'false') return { ok: true, value: { ...EMPTY_VALUE, bool: false } }
      return { ok: false, error: 'Choose Yes or No.' }
    }
    case 'picklist': {
      // A name the choice used to have is read as the choice it is now.
      const wanted = (field.optionAliases?.[text.toLowerCase()] ?? text).toLowerCase()
      const match =
        (field.options ?? []).find((option) => option.toLowerCase() === wanted) ??
        // A retired choice can't be picked afresh, but a record that holds it may be saved again unchanged.
        (field.retiredOptions ?? []).find((option) => option.toLowerCase() === wanted)
      // Values that came from before the list existed are kept as they are.
      if (!match && field.options && field.options.length > 0) return { ok: false, error: 'Choose one of the listed options.' }
      return { ok: true, value: { ...EMPTY_VALUE, text: match ?? text } }
    }
    default:
      if (text.length > 2000) return { ok: false, error: 'That entry is too long.' }
      return { ok: true, value: { ...EMPTY_VALUE, text } }
  }
}

/** "2026-03" (from a month picker) -> "2026-03-01"; null when it isn't a month. */
export function monthToPeriod(month: string): string | null {
  const text = month.trim()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return null
  return `${text}-01`
}
