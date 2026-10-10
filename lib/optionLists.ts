// The choices of a drop-down (pick list) field. Browser-safe: no database here.
//
// A choice is more than its label:
// - `key` is permanent. The label can be renamed freely; anything the app
//   hangs on a choice (the stack plan for Office, a subtype's parent) uses
//   the key.
// - `parent` ties a choice to one choice of the field this one depends on:
//   the subtype "Medical Office" belongs to the property type "office".
// - `countsAs` is for a choice an organization added to a standard list: the
//   standard choice it is a kind of, so "Medical Campus" still counts as
//   Office wherever the type matters.
// - `retired` hides a choice from new picks; records that hold it keep it.
// - `aliases` are names the choice used to have. Stored values are the label
//   as it was when saved, so an old label still finds its choice and is shown
//   under the current one.
//
// In the database a list is a JSON array on the field. Older lists are plain
// strings ("A", "B", "C"); those read as choices keyed from their label.

export type FieldOption = {
  key: string
  label: string
  parent: string | null
  countsAs: string | null
  retired: boolean
  aliases: string[]
}

export const MAX_OPTIONS = 200
export const MAX_OPTION_LABEL = 100

const lower = (text: string) => text.trim().toLowerCase()

/** "Self-Storage" -> "selfStorage". Never empty. */
export function keyFromLabel(label: string): string {
  const words = label.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  const key = words.map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase())).join('').slice(0, 60)
  return /^[a-z]/.test(key) ? key : `option${key ? key[0].toUpperCase() + key.slice(1) : ''}`
}

/** A key not yet in `taken`: "office", then "office2", "office3". */
export function uniqueKey(base: string, taken: Set<string>): string {
  let key = base
  for (let suffix = 2; taken.has(key); suffix += 1) key = `${base}${suffix}`
  return key
}

/** Reads a stored list, whatever its age, into choices. Anything unusable is dropped. */
export function normalizeOptions(raw: unknown): FieldOption[] {
  if (!Array.isArray(raw)) return []
  const options: FieldOption[] = []
  const taken = new Set<string>()
  for (const entry of raw) {
    const source = typeof entry === 'string' ? { label: entry } : entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
    if (!source) continue
    const label = String(source.label ?? '').trim().slice(0, MAX_OPTION_LABEL)
    if (!label) continue
    const wanted = typeof source.key === 'string' && /^[A-Za-z][A-Za-z0-9]{0,59}$/.test(source.key) ? source.key : keyFromLabel(label)
    const key = uniqueKey(wanted, taken)
    taken.add(key)
    options.push({
      key,
      label,
      parent: typeof source.parent === 'string' && source.parent ? source.parent : null,
      countsAs: typeof source.countsAs === 'string' && source.countsAs ? source.countsAs : null,
      retired: source.retired === true,
      aliases: Array.isArray(source.aliases) ? source.aliases.map((alias) => String(alias ?? '').trim()).filter(Boolean).slice(0, 20) : [],
    })
    if (options.length >= MAX_OPTIONS) break
  }
  return options
}

/** How a list is written to the database: only what is set, so a simple list stays readable. */
export function storedOptions(options: FieldOption[]): Record<string, unknown>[] {
  return options.map((option) => ({
    key: option.key,
    label: option.label,
    ...(option.parent ? { parent: option.parent } : {}),
    ...(option.countsAs ? { countsAs: option.countsAs } : {}),
    ...(option.retired ? { retired: true } : {}),
    ...(option.aliases.length > 0 ? { aliases: option.aliases } : {}),
  }))
}

/**
 * What a parent field holds, as the keys a dependent choice may be tied to:
 * the held choice's own key and, for a choice an organization added, the
 * standard one it counts as. So a "Medical Campus" type that counts as Office
 * is offered the Office subtypes. Null when the parent field is empty.
 */
export type ParentKeys = string | string[] | null
export const parentKeysOf = (option: FieldOption | null): string[] | null => (option ? (option.countsAs ? [option.key, option.countsAs] : [option.key]) : null)

/** Whether a choice may be picked under what the parent field holds. A choice tied to no parent always may. */
export function belongsTo(option: FieldOption, parentKey: ParentKeys): boolean {
  if (option.parent === null) return true
  if (parentKey === null) return false
  return Array.isArray(parentKey) ? parentKey.includes(option.parent) : option.parent === parentKey
}

/**
 * The choice a stored label stands for: by its current label, else by a name
 * it used to have. When the field depends on another, `parentKey` picks
 * between choices that share a label ("Life Science" under Office and under
 * Industrial); pass undefined when the parent is not known.
 */
export function findOption(options: FieldOption[], label: string | null | undefined, parentKey?: ParentKeys): FieldOption | null {
  const wanted = lower(label ?? '')
  if (!wanted) return null
  const fits = (option: FieldOption) => parentKey === undefined || belongsTo(option, parentKey)
  return (
    options.find((option) => lower(option.label) === wanted && fits(option)) ??
    options.find((option) => option.aliases.some((alias) => lower(alias) === wanted) && fits(option)) ??
    (parentKey === undefined ? null : findOption(options, label))
  )
}

/** The standard choice a stored label counts as: its own key, or the one an added choice was mapped to. */
export function standardKeyOf(options: FieldOption[], label: string | null | undefined): string | null {
  const option = findOption(options, label)
  return option ? option.countsAs ?? option.key : null
}

/**
 * The choices that can be picked now. With `parentKey` (the key of the choice
 * held by the field this one depends on) only those belonging to it, plus any
 * that belong to every parent. Null means the parent field is empty: nothing
 * tied to a parent can be picked yet.
 */
export function pickable(options: FieldOption[], parentKey?: ParentKeys): FieldOption[] {
  return options.filter((option) => !option.retired && (parentKey === undefined || belongsTo(option, parentKey)))
}

/** Labels without repeats, in order. */
export function labelsOf(options: FieldOption[]): string[] {
  const seen = new Set<string>()
  return options.filter((option) => (seen.has(lower(option.label)) ? false : (seen.add(lower(option.label)), true))).map((option) => option.label)
}

/** The label to show for a stored value: the choice's current name when the value is an older one. */
export function currentLabel(options: FieldOption[], stored: string): string {
  if (options.some((option) => lower(option.label) === lower(stored))) return stored
  return findOption(options, stored)?.label ?? stored
}

/** The key of the Office property type, which the stack plan is drawn for. */
export const OFFICE_KEY = 'office'
