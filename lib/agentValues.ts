// Setting a field's value because the person asked the Portfolio Analyst to.
//
// It is the same save as typing the value on the asset page: the person's
// roles must allow editing the field, the value is recorded as Manual Entry
// under their name, and the change goes into the field's history, with a note
// saying it came through the analyst. The analyst names the field and the
// record in words; this file works out which ones are meant and refuses when
// that is not clear, so a value never lands on the wrong record.

import { formatPeriod, formatValue, monthToPeriod, parseInput } from './fieldFormat'
import { listFields, saveManualValue, type FieldDefinition } from './fields'
import { loadAccess, sectionOfField } from './permissions'
import { getAssetTree, RECORD_LABELS, type Queryable, type RecordType } from './records'

export const ANALYST_NOTE = 'Entered through the Portfolio Analyst'

export type AgentValueInput = {
  assetId: string
  /** The field's name as shown on screen, or its key. */
  field: string
  /** The property's or building's name, when the asset has more than one the field could belong to. */
  recordName?: string | null
  /** The value as a person would type it. */
  value: string
  /** "YYYY-MM" for a field tracked by month. */
  month?: string | null
  /** True to empty the field. */
  clear?: boolean
}

export type AgentValueResult =
  | { ok: true; changed: boolean; field: string; record: string; value: string; month: string | null }
  | { ok: false; error: string }

const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '')

type Target = { type: RecordType; id: string; name: string; label: string }

/** Every way a record might be named back to us: "Knoll Trail", "Property: Knoll Trail", "Knoll Trail / Main Building". */
function namesOf(target: Target, parentName: string | null): string[] {
  const names = [target.name, `${RECORD_LABELS[target.type]}: ${target.name}`, `${RECORD_LABELS[target.type]} ${target.name}`]
  if (parentName) names.push(`${parentName} / ${target.name}`, `${RECORD_LABELS[target.type]}: ${parentName} / ${target.name}`)
  return names.map(plain)
}

export async function setValueForAgent(client: Queryable, orgId: string, userId: string, isAdmin: boolean, input: AgentValueInput): Promise<AgentValueResult> {
  const tree = await getAssetTree(client, orgId, input.assetId)
  if (!tree) return { ok: false, error: 'That asset could not be found.' }

  const raw = String(input.value ?? '').trim()
  if (!raw && !input.clear) return { ok: false, error: 'No value was given. To empty a field on purpose, say so with clear.' }
  if (raw && input.clear) return { ok: false, error: 'Give a value or ask to clear the field, not both.' }

  const targets: { target: Target; names: string[] }[] = [{ target: { type: 'asset', id: tree.id, name: tree.name, label: `${RECORD_LABELS.asset}: ${tree.name}` }, names: [] }]
  for (const property of tree.properties) {
    targets.push({ target: { type: 'property', id: property.id, name: property.name, label: `${RECORD_LABELS.property}: ${property.name}` }, names: [] })
    for (const building of property.buildings) {
      const target: Target = { type: 'building', id: building.id, name: building.name, label: `${RECORD_LABELS.building}: ${property.name} / ${building.name}` }
      targets.push({ target, names: namesOf(target, property.name) })
    }
  }
  for (const entry of targets) if (entry.names.length === 0) entry.names = namesOf(entry.target, null)

  // Fields the person can't see are treated as if they did not exist.
  const access = await loadAccess(client, orgId, userId, isAdmin)
  const wanted = plain(input.field)
  if (!wanted) return { ok: false, error: 'Say which field to set.' }
  const visible: { field: FieldDefinition; level: string }[] = []
  for (const field of await listFields(client, orgId)) {
    if (field.listId || (plain(field.name) !== wanted && plain(field.key) !== wanted)) continue
    const level = access.fieldLevel(field.id, await sectionOfField(client, orgId, field.id))
    if (level !== 'hidden') visible.push({ field, level })
  }
  if (visible.length === 0) return { ok: false, error: `There is no field called "${input.field.trim().slice(0, 100)}". Use a field name exactly as get_asset lists it.` }

  const recordName = plain(input.recordName ?? '')
  const choices = visible.flatMap(({ field, level }) =>
    targets.filter(({ target, names }) => target.type === field.appliesTo && (!recordName || names.includes(recordName))).map(({ target }) => ({ field, level, target })),
  )
  if (choices.length === 0) {
    const kinds = [...new Set(visible.map(({ field }) => RECORD_LABELS[field.appliesTo].toLowerCase()))].join(' or ')
    return {
      ok: false,
      error: recordName
        ? `${visible[0].field.name} belongs to a ${kinds}, and this asset has none called "${String(input.recordName).trim().slice(0, 100)}". The choices are: ${targets.filter(({ target }) => visible.some(({ field }) => field.appliesTo === target.type)).map(({ target }) => target.label).join('; ') || 'none'}.`
        : `${visible[0].field.name} belongs to a ${kinds}, and this asset has none.`,
    }
  }
  if (choices.length > 1) {
    return { ok: false, error: `More than one record has ${visible[0].field.name}. Ask the person which one they mean, then give its name as record_name: ${choices.map((choice) => choice.target.label).join('; ')}.` }
  }

  const { field, level, target } = choices[0]
  if (level !== 'edit') return { ok: false, error: `The person's role does not allow changing ${field.name}.` }
  if (field.dataType === 'picklist' && raw && field.options && field.options.length > 0 && !field.options.some((option) => option.toLowerCase() === raw.toLowerCase())) {
    return { ok: false, error: `${field.name} must be one of: ${field.options.join(', ')}.` }
  }
  if (field.dataType === 'date' && raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: false, error: 'Write the date as YYYY-MM-DD, for example 2026-03-31.' }
  if (field.tracking === 'monthly' && !monthToPeriod(input.month ?? '')) return { ok: false, error: `${field.name} is kept month by month. Ask which month the value is for and give it as YYYY-MM.` }

  const parsed = parseInput(field, raw)
  if (!parsed.ok) return parsed
  const saved = await saveManualValue(client, orgId, userId, { recordType: target.type, recordId: target.id, fieldId: field.id, month: input.month ?? null, raw, note: ANALYST_NOTE })
  if (!saved.ok) return saved
  const period = field.tracking === 'monthly' ? monthToPeriod(input.month ?? '') : null
  return { ok: true, changed: saved.changed, field: field.name, record: target.label, value: raw ? formatValue(field, parsed.value) : '(emptied)', month: period ? formatPeriod(period) : null }
}
