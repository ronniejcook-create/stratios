// Location facts: what public sources say about a property's address, saved
// as ordinary fields on the property (the standard "Location" section).
//
// They are filled in whenever the property's place on the map changes: an
// address is added, replaced, given a location or removed, by hand or from a
// document. The Refresh Location button asks again. The same sources feed the
// Map tab's layers; the demographics layer is not saved.
//
// Each value is stored like any other: a golden record, a history entry and
// the source's own value, recorded as Market Data with a note naming the
// source and the address. A value a person typed over one is left alone when
// the field says hand-entered values stay.

import { withOrg } from './db'
import { listFields, saveManualValue } from './fields'
import { loadAccess, sectionOfField } from './permissions'
import { FLOOD_LABELS, floodProfile } from './floodZones'
import { HAZARD_RATINGS, hazardProfile } from './hazards'
import { jobsProfile } from './jobs'
import { formatAddress, type Address, type Queryable } from './records'
import { schoolProfile } from './schools'
import { transitProfile, TRANSIT_LABELS } from './transit'

export const LOCATION_TOPICS = ['flood', 'schools', 'transit', 'hazards', 'jobs'] as const
export type LocationTopic = (typeof LOCATION_TOPICS)[number]

/** The standard fields each source fills, by key. All belong to the property. */
export const LOCATION_FIELDS: Record<LocationTopic, readonly string[]> = {
  flood: ['floodZone', 'floodRisk', 'specialFloodHazardArea'],
  schools: ['schoolDistrict'],
  transit: ['nearestRailStation', 'distanceToRailStation'],
  hazards: ['naturalHazardRating', 'highestNaturalHazards'],
  jobs: ['jobsWithin1Mile', 'jobsWithin3Miles', 'walkabilityScore'],
}
export const LOCATION_FIELD_KEYS: readonly string[] = LOCATION_TOPICS.flatMap((topic) => LOCATION_FIELDS[topic])

const SOURCES: Record<LocationTopic, string> = {
  flood: "FEMA's National Flood Hazard Layer",
  schools: 'the National Center for Education Statistics',
  transit: 'the National Transit Map',
  hazards: "FEMA's National Risk Index",
  jobs: 'the EPA Smart Location Database',
}
/** How a source is named when it could not be asked. */
const TOPIC_NAMES: Record<LocationTopic, string> = { flood: 'flood zone', schools: 'school district', transit: 'nearest rail station', hazards: 'natural hazards', jobs: 'jobs and walkability' }

export type Point = { latitude: number; longitude: number; address: string }
/** One field's new value as a person would type it; empty clears the field. */
export type Fact = { key: string; raw: string; note: string }
export type Gathered = { facts: Fact[]; failed: LocationTopic[] }

const samePoint = (a: Point | null, b: Point | null) => (a === null || b === null ? a === b : a.latitude === b.latitude && a.longitude === b.longitude)

/** The pure part: turns each source's answer (null when it could not be had) into field values. */
export function factsFrom(
  answers: {
    flood: Awaited<ReturnType<typeof floodProfile>> | null
    schools: Awaited<ReturnType<typeof schoolProfile>> | null
    transit: Awaited<ReturnType<typeof transitProfile>> | null
    hazards: Awaited<ReturnType<typeof hazardProfile>> | null
    jobs: Awaited<ReturnType<typeof jobsProfile>> | null
  },
  address: string,
): Gathered {
  const facts: Fact[] = []
  const failed: LocationTopic[] = []
  const noteFor = (topic: LocationTopic, extra = '') => `From ${SOURCES[topic]}${extra}, for ${address || 'the property\'s address'}`
  const set = (topic: LocationTopic, key: string, value: string | number | null | undefined, extra = '') =>
    facts.push({ key, raw: value === null || value === undefined ? '' : String(value), note: noteFor(topic, extra) })

  const flood = answers.flood
  if (flood?.ok) {
    const at = flood.profile.at
    set('flood', 'floodZone', at?.zone)
    set('flood', 'floodRisk', at ? FLOOD_LABELS[at.kind] : null)
    set('flood', 'specialFloodHazardArea', at ? (at.special ? 'Yes' : 'No') : null)
  } else failed.push('flood')

  const schools = answers.schools
  if (schools?.ok && !schools.profile.missing.includes('the school district')) set('schools', 'schoolDistrict', schools.profile.district?.name)
  else failed.push('schools')

  const transit = answers.transit
  if (transit?.ok && !transit.profile.missing.includes('rail stations further out')) {
    const rail = transit.profile.nearestRail
    // Empty means no rail station within the distance the map looks (3 miles).
    set('transit', 'nearestRailStation', rail ? `${rail.name} (${TRANSIT_LABELS[rail.kind]})` : null)
    set('transit', 'distanceToRailStation', rail ? Math.round(rail.miles * 100) / 100 : null)
  } else failed.push('transit')

  const hazards = answers.hazards
  if (hazards?.ok) {
    const at = hazards.profile.at
    const edition = hazards.profile.version ? ` (${hazards.profile.version})` : ''
    set('hazards', 'naturalHazardRating', at?.overall ? HAZARD_RATINGS[at.overall.level] : null, edition)
    const top = (at?.hazards ?? []).filter((hazard) => hazard.level >= 2).slice(0, 4).map((hazard) => `${hazard.label} (${HAZARD_RATINGS[hazard.level]})`)
    set('hazards', 'highestNaturalHazards', top.length > 0 ? top.join('; ') : null, edition)
  } else failed.push('hazards')

  const jobs = answers.jobs
  if (jobs?.ok && !jobs.profile.missing.includes('the jobs in the surrounding area')) {
    const year = ` (${jobs.profile.jobsYear} job counts)`
    const ring = (distance: number) => jobs.profile.rings.find((entry) => entry.miles === distance)?.jobs
    set('jobs', 'jobsWithin1Mile', ring(1), year)
    set('jobs', 'jobsWithin3Miles', ring(3), year)
    set('jobs', 'walkabilityScore', jobs.profile.at?.walkability)
  } else failed.push('jobs')

  return { facts, failed }
}

/** Asks every source at once. One that fails or is slow is listed in `failed`; the others still answer. */
export async function gatherLocationFacts(point: Point, timeoutMs = 9000): Promise<Gathered> {
  const within = async <T>(work: Promise<T>): Promise<T | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([work, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) })])
    } catch (error) {
      console.error('A location lookup failed', error)
      return null
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  const { latitude, longitude } = point
  const [flood, schools, transit, hazards, jobs] = await Promise.all([
    within(floodProfile(latitude, longitude)),
    within(schoolProfile(latitude, longitude)),
    within(transitProfile(latitude, longitude)),
    within(hazardProfile(latitude, longitude)),
    within(jobsProfile(latitude, longitude)),
  ])
  return factsFrom({ flood, schools, transit, hazards, jobs }, point.address)
}

/**
 * Where a property is for these lookups: its own address when that has a
 * map location, otherwise the first of its buildings' that has one.
 */
export async function pointOfProperty(client: Queryable, orgId: string, propertyId: string): Promise<Point | null> {
  const { rows } = await client.query(
    `select d.street, d.suite, d.city, d.state, d.postal_code,
            (to_jsonb(d) ->> 'latitude')::double precision as latitude, (to_jsonb(d) ->> 'longitude')::double precision as longitude
     from addresses d
     left join buildings b on b.id = d.building_id
     where d.org_id = $1 and (d.property_id = $2 or b.property_id = $2)
       and (to_jsonb(d) ->> 'latitude') is not null and (to_jsonb(d) ->> 'longitude') is not null
     order by (d.property_id is null), d.created_at
     limit 1`,
    [orgId, propertyId],
  )
  const row = rows[0]
  if (!row) return null
  const address: Address = { id: '', street: row.street ?? null, suite: row.suite ?? null, city: row.city ?? null, state: row.state ?? null, postalCode: row.postal_code ?? null, latitude: Number(row.latitude), longitude: Number(row.longitude) }
  return { latitude: Number(row.latitude), longitude: Number(row.longitude), address: formatAddress(address) }
}

/** The property an address owner belongs to: the property itself, or a building's. Null for a unit, whose address never moves the property. */
export async function propertyOfOwner(client: Queryable, orgId: string, ownerType: string, ownerId: string): Promise<string | null> {
  if (ownerType === 'property') return ownerId
  if (ownerType !== 'building') return null
  const { rows } = await client.query('select property_id::text as id from buildings where org_id = $1 and id = $2', [orgId, ownerId])
  return rows[0]?.id ?? null
}

/** The property an existing address sits under (its own, or its building's); null for a unit's address. */
export async function propertyOfAddress(client: Queryable, orgId: string, addressId: string): Promise<string | null> {
  const { rows } = await client.query(
    `select coalesce(d.property_id, b.property_id)::text as id
     from addresses d left join buildings b on b.id = d.building_id
     where d.org_id = $1 and d.id = $2`,
    [orgId, addressId],
  )
  return rows[0]?.id ?? null
}

/**
 * Writes the facts onto the property. Fields that don't exist yet (the
 * migration has not been run) are skipped. Returns how many values changed.
 */
export async function saveLocationFacts(client: Queryable, orgId: string, userId: string, propertyId: string, facts: Fact[]): Promise<number> {
  if (facts.length === 0) return 0
  const fields = new Map((await listFields(client, orgId)).filter((field) => field.standard && field.appliesTo === 'property' && !field.listId && !field.calculated).map((field) => [field.key, field]))
  let changed = 0
  for (const fact of facts) {
    const field = fields.get(fact.key)
    if (!field) continue
    const saved = await saveManualValue(client, orgId, userId, { recordType: 'property', recordId: propertyId, fieldId: field.id, raw: fact.raw, fromLookup: { note: fact.note } })
    if (saved.ok && saved.changed) changed += 1
    else if (!saved.ok) console.error(`Saving the location fact ${fact.key} failed: ${saved.error}`)
  }
  return changed
}

export type RefreshResult =
  | { ok: true; changed: number; failed: string[]; address: string }
  | { ok: false; reason: 'no-location' | 'failed' }

/**
 * Looks the property's address up again and saves what comes back. With
 * `moved`, the address is a different place than before, so the fields of a
 * source that could not be asked are emptied: a flood zone left over from the
 * old address would be wrong, and an empty field is honest.
 * No database transaction is open while the sources are asked.
 */
export async function refreshLocationFacts(orgId: string, userId: string, propertyId: string, options: { moved?: boolean; timeoutMs?: number } = {}): Promise<RefreshResult> {
  try {
    const point = await withOrg(orgId, (client) => pointOfProperty(client, orgId, propertyId))
    if (!point) return { ok: false, reason: 'no-location' }
    const { facts, failed } = await gatherLocationFacts(point, options.timeoutMs)
    if (options.moved) {
      for (const topic of failed) {
        for (const key of LOCATION_FIELDS[topic]) facts.push({ key, raw: '', note: `Emptied: the address changed and ${SOURCES[topic]} could not be reached. Use Refresh Location to try again.` })
      }
    }
    const changed = await withOrg(orgId, (client) => saveLocationFacts(client, orgId, userId, propertyId, facts))
    return { ok: true, changed, failed: failed.map((topic) => TOPIC_NAMES[topic]), address: point.address }
  } catch (error) {
    console.error('Refreshing location facts failed', error)
    return { ok: false, reason: 'failed' }
  }
}

/**
 * Call after an address under a property was added, replaced, located or
 * removed, with where the property was before. Does nothing when the place
 * is the same; empties the fields when the property no longer has a place;
 * otherwise looks the new place up. Never throws: the address change it
 * follows has already been saved.
 */
export async function followAddressChange(orgId: string, userId: string, propertyId: string, before: Point | null, timeoutMs?: number): Promise<void> {
  try {
    const after = await withOrg(orgId, (client) => pointOfProperty(client, orgId, propertyId))
    if (samePoint(before, after)) return
    if (!after) {
      const facts = LOCATION_FIELD_KEYS.map((key) => ({ key, raw: '', note: 'Emptied: the property no longer has an address with a map location.' }))
      await withOrg(orgId, (client) => saveLocationFacts(client, orgId, userId, propertyId, facts))
      return
    }
    await refreshLocationFacts(orgId, userId, propertyId, { moved: true, timeoutMs })
  } catch (error) {
    console.error('Following an address change failed', error)
  }
}

/** The Location fields shown as columns in the Assets list. */
export const ASSET_LIST_FACTS = [
  { key: 'floodZone', label: 'Flood Zone' },
  { key: 'schoolDistrict', label: 'School District' },
] as const

export type AssetLocations = {
  /** The columns this person may see, in order. A field hidden from them, or not there yet, is left out. */
  columns: { key: string; label: string }[]
  /** For each asset, each column's distinct values across its properties. */
  byAsset: Map<string, Record<string, string[]>>
}

/** What the Assets list shows of each asset's Location fields, for one person. */
export async function listAssetLocations(client: Queryable, orgId: string, userId: string, isAdmin: boolean): Promise<AssetLocations> {
  const wanted = ASSET_LIST_FACTS.map((fact) => fact.key as string)
  const fields = (await listFields(client, orgId)).filter((field) => field.standard && field.appliesTo === 'property' && !field.listId && wanted.includes(field.key))
  const access = await loadAccess(client, orgId, userId, isAdmin)
  const visible: typeof fields = []
  for (const field of fields) {
    if (access.fieldLevel(field.id, await sectionOfField(client, orgId, field.id)) !== 'hidden') visible.push(field)
  }
  const byAsset: AssetLocations['byAsset'] = new Map()
  if (visible.length > 0) {
    const { rows } = await client.query(
      `select p.asset_id::text as asset_id, v.field_id::text as field_id, v.value_text
       from field_values v join properties p on p.id = v.record_id and p.org_id = v.org_id
       where v.org_id = $1 and v.record_type = 'property' and v.field_id = any($2::uuid[])
         and v.status = 'approved' and v.row_id is null and v.value_text is not null and v.value_text <> ''
       order by p.created_at`,
      [orgId, visible.map((field) => field.id)],
    )
    const keyOf = new Map(visible.map((field) => [field.id, field.key]))
    for (const row of rows) {
      const key = keyOf.get(row.field_id)
      if (!key) continue
      const entry = byAsset.get(row.asset_id) ?? {}
      const values = (entry[key] ??= [])
      if (!values.includes(row.value_text)) values.push(row.value_text)
      byAsset.set(row.asset_id, entry)
    }
  }
  return { columns: ASSET_LIST_FACTS.filter((fact) => visible.some((field) => field.key === fact.key)).map((fact) => ({ key: fact.key, label: visible.find((field) => field.key === fact.key)!.name || fact.label })), byAsset }
}
