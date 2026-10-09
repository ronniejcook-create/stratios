// Schools around a point, from the National Center for Education Statistics
// (NCES), the U.S. Department of Education's statistics office. Its map
// services are free and need no account or key. Four questions are asked: the
// public schools nearby (with grades, students and teachers), the private
// schools, the colleges and career schools, and the school district the point
// is in.
//
// NCES publishes each school year as its own service, named by the year. The
// names below are the latest of each kind (checked October 2026); older years
// stay online, so nothing breaks when a new year appears, it just isn't used
// until these are changed.
//
// What is deliberately left out: NCES also gives each public school's students
// by race and by free-lunch eligibility. Those are not read or shown, because
// they have no place in leasing or lending decisions.
//
// Everything except `schoolProfile` at the bottom is plain arithmetic and
// reading of answers, so it can be tested without the service.

const BASE = 'https://nces.ed.gov/opengis/rest/services'
const PUBLIC_URL = `${BASE}/K12_School_Locations/EDGE_ADMINDATA_PUBLICSCH_2425/MapServer/1/query`
const PRIVATE_URL = `${BASE}/K12_School_Locations/EDGE_GEOCODE_PRIVATESCH_2324/MapServer/0/query`
const COLLEGE_URL = `${BASE}/Postsecondary_School_Locations/EDGE_GEOCODE_POSTSECONDARYSCH_2526/MapServer/0/query`
const DISTRICT_URL = `${BASE}/School_District_Boundaries/EDGE_ADMINDATA_SCHOOLDISTRICTS_SY2425/MapServer/1/query`
export const SCHOOL_YEARS = { public: '2024-25', private: '2023-24', college: '2025-26' } as const

/** How far out schools are listed, in miles. */
export const SCHOOL_MILES = 3
const METERS_PER_MILE = 1609.344
/** School lists change once a year; an answer is kept for a month. */
const KEEP_SECONDS = 30 * 24 * 60 * 60

/** The groups schools are shown in. The first four are public schools by level. */
export type SchoolKind = 'elementary' | 'middle' | 'high' | 'otherPublic' | 'private' | 'college'
export const SCHOOL_KINDS: readonly SchoolKind[] = ['elementary', 'middle', 'high', 'otherPublic', 'private', 'college']
export const SCHOOL_LABELS: Record<SchoolKind, string> = {
  elementary: 'Public Elementary',
  middle: 'Public Middle',
  high: 'Public High',
  otherPublic: 'Other Public',
  private: 'Private',
  college: 'College or Career School',
}

export type School = {
  id: string
  name: string
  kind: SchoolKind
  latitude: number
  longitude: number
  /** Straight-line miles from the point. */
  miles: number
  /** The school's own street address and city. */
  address: string
  /** Public schools only: the district or charter operator that runs it. */
  operator: string | null
  /** Public schools only: run by the district the point is in. */
  inDistrict: boolean
  charter: boolean
  /** Public schools only: "PK to 5". */
  grades: string | null
  students: number | null
  /** Students for each full-time teacher. */
  studentsPerTeacher: number | null
}

export type SchoolDistrict = { id: string; name: string; grades: string | null; schools: number | null; students: number | null; studentsPerTeacher: number | null }

export type SchoolProfile = {
  /** The district the point is in; null when NCES has none there. */
  district: SchoolDistrict | null
  /** Every school within the distance, nearest first. */
  schools: School[]
  /** How many of each group. */
  counts: Record<SchoolKind, number>
  miles: number
  /** Kinds of school that could not be loaded this time ("private schools", "colleges", "the school district"). */
  missing: string[]
}
export type SchoolResult = { ok: true; profile: SchoolProfile } | { ok: false; error: string }

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
/** NCES writes "not reported" and "not applicable" as negative numbers. */
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

/** Straight-line miles between two points given as [latitude, longitude]. */
export function milesApart(a: [number, number], b: [number, number]): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = radians(b[0] - a[0])
  const dLng = radians(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Words that stay in capitals when a name written all in capitals is tidied. */
const KEEP_UPPER = new Set(['ISD', 'CISD', 'USD', 'STEM', 'STEAM', 'II', 'III', 'IV', 'PK', 'DAEP', 'JJAEP', 'KIPP', 'IDEA', 'TX', 'UT'])
/** Short forms public school lists end names with. */
/** Small words that stay small inside a name. */
const SMALL = new Set(['OF', 'THE', 'AND', 'FOR', 'AT', 'IN', 'ON', 'A', 'AN', 'TO'])
const ENDINGS: [RegExp, string][] = [[/ EL$/, ' Elementary'], [/ H S$/, ' High School'], [/ J H$/, ' Junior High'], [/ MIDDLE$/, ' Middle School']]

/** "ANNE FRANK EL" -> "Anne Frank Elementary". A name that already has small letters is left as written. */
export function tidyName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim()
  if (!trimmed || /[a-z]/.test(trimmed)) return trimmed
  let upper = trimmed
  for (const [ending, full] of ENDINGS) upper = upper.replace(ending, full.toUpperCase())
  return upper
    .split(' ')
    .map((word, index) => (KEEP_UPPER.has(word) ? word : index > 0 && SMALL.has(word) ? word.toLowerCase() : word.toLowerCase().replace(/(^|[-'/.(&])([a-z])/g, (whole, lead: string, letter: string) => lead + letter.toUpperCase())))
    .join(' ')
    // A letter after an apostrophe is only a capital at the start of a name part (O'Neil), not in a possessive (St. Mark's).
    .replace(/'S\b/g, "'s")
}

const GRADE_NAMES: Record<string, string> = { PK: 'PK', KG: 'K', UG: 'Ungraded', AE: 'Adult Education', '13': '13' }
const grade = (code: string) => GRADE_NAMES[code] ?? (/^\d+$/.test(code) ? String(Number(code)) : '')

/** "PK" and "05" -> "PK to 5"; null when NCES gives no grades. */
export function gradeSpan(low: unknown, high: unknown): string | null {
  const from = grade(text(low).toUpperCase())
  const to = grade(text(high).toUpperCase())
  if (!from && !to) return null
  if (!to || from === to) return from || to
  return from ? `${from} to ${to}` : to
}

function publicKind(level: string): SchoolKind {
  const word = level.toLowerCase()
  if (word === 'elementary' || word === 'prekindergarten') return 'elementary'
  if (word === 'middle') return 'middle'
  if (word === 'high' || word === 'secondary') return 'high'
  return 'otherPublic'
}

type Feature = { attributes?: Record<string, unknown>; geometry?: { x?: unknown; y?: unknown } }
const featuresOf = (body: unknown): Feature[] => {
  const features = (body as { features?: unknown } | null)?.features
  return Array.isArray(features) ? (features as Feature[]) : []
}

/** Where a school is, from its point on the map or, failing that, the coordinates in its record. */
function place(feature: Feature, latKey: string, lngKey: string): [number, number] | null {
  const row = feature.attributes ?? {}
  const lat = typeof feature.geometry?.y === 'number' ? feature.geometry.y : row[latKey]
  const lng = typeof feature.geometry?.x === 'number' ? feature.geometry.x : row[lngKey]
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null
}

const addressOf = (street: unknown, city: unknown) => [tidyName(text(street)), tidyName(text(city))].filter(Boolean).join(', ')

/** Public schools from NCES's answer. Closed, inactive and not-yet-open schools are left out. */
export function readPublic(body: unknown, center: [number, number], districtId: string | null = null): School[] {
  const schools: School[] = []
  for (const feature of featuresOf(body)) {
    const row = feature.attributes ?? {}
    const at = place(feature, 'LATCOD', 'LONCOD')
    const name = tidyName(text(row.SCH_NAME))
    // Status 2 is closed, 6 inactive, 7 planned for a later year.
    if (!at || !name || ['2', '6', '7'].includes(text(row.STATUS))) continue
    const ratio = count(row.STUTERATIO)
    schools.push({
      id: `public-${text(row.NCESSCH) || schools.length}`,
      name,
      kind: publicKind(text(row.SCHOOL_LEVEL)),
      latitude: at[0],
      longitude: at[1],
      miles: milesApart(center, at),
      address: addressOf(row.LSTREET1, row.LCITY),
      operator: tidyName(text(row.LEA_NAME)) || null,
      inDistrict: districtId !== null && text(row.LEAID) === districtId,
      charter: text(row.CHARTER_TEXT).toLowerCase() === 'yes',
      grades: gradeSpan(row.GSLO, row.GSHI),
      students: count(row.MEMBER) ?? count(row.TOTAL),
      studentsPerTeacher: ratio !== null && ratio > 0 ? Number(ratio.toFixed(1)) : null,
    })
  }
  return schools
}

/** Private schools or colleges from NCES's answer; these lists carry a name and a place only. */
export function readListed(body: unknown, center: [number, number], kind: 'private' | 'college'): School[] {
  const schools: School[] = []
  // The private school list holds some schools twice under different numbers; one of each name and street is kept.
  const seen = new Set<string>()
  for (const feature of featuresOf(body)) {
    const row = feature.attributes ?? {}
    const at = place(feature, 'LAT', 'LON')
    const name = tidyName(text(row.NAME))
    const key = `${name.toLowerCase()}|${text(row.STREET).toLowerCase()}`
    if (!at || !name || seen.has(key)) continue
    seen.add(key)
    schools.push({
      id: `${kind}-${text(row.PPIN) || text(row.UNITID) || schools.length}`,
      name,
      kind,
      latitude: at[0],
      longitude: at[1],
      miles: milesApart(center, at),
      address: addressOf(row.STREET, row.CITY),
      operator: null,
      inDistrict: false,
      charter: false,
      grades: null,
      students: null,
      studentsPerTeacher: null,
    })
  }
  return schools
}

/** The district at the point. Where an elementary and a secondary district overlap, the one with more students is given. */
export function readDistrict(body: unknown): SchoolDistrict | null {
  const districts = featuresOf(body)
    .map((feature) => feature.attributes ?? {})
    .filter((row) => text(row.LEA_NAME))
    .sort((a, b) => (count(b.MEMBER) ?? 0) - (count(a.MEMBER) ?? 0))
  const row = districts[0]
  if (!row) return null
  const ratio = count(row.STUTERATIO)
  return {
    id: text(row.LEAID),
    name: tidyName(text(row.LEA_NAME)),
    grades: gradeSpan(row.GSLO, row.GSHI),
    schools: count(row.SCH),
    students: count(row.MEMBER),
    studentsPerTeacher: ratio !== null && ratio > 0 ? Number(ratio.toFixed(1)) : null,
  }
}

/** The four questions to ask NCES about a point. */
export function schoolUrls(latitude: number, longitude: number): { public: string; private: string; college: string; district: string } {
  const at = { geometry: `${longitude.toFixed(5)},${latitude.toFixed(5)}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outSR: '4326', f: 'json' }
  const near = { ...at, distance: String(Math.round(SCHOOL_MILES * METERS_PER_MILE)), units: 'esriSRUnit_Meter', returnGeometry: 'true' }
  const listed = 'NAME,STREET,CITY,LAT,LON'
  return {
    public: `${PUBLIC_URL}?${new URLSearchParams({ ...near, outFields: 'NCESSCH,LEAID,SCH_NAME,LEA_NAME,LSTREET1,LCITY,CHARTER_TEXT,GSLO,GSHI,SCHOOL_LEVEL,STATUS,MEMBER,TOTAL,STUTERATIO,LATCOD,LONCOD' })}`,
    private: `${PRIVATE_URL}?${new URLSearchParams({ ...near, outFields: `PPIN,${listed}` })}`,
    college: `${COLLEGE_URL}?${new URLSearchParams({ ...near, outFields: `UNITID,${listed}` })}`,
    district: `${DISTRICT_URL}?${new URLSearchParams({ ...at, returnGeometry: 'false', outFields: 'LEAID,LEA_NAME,GSLO,GSHI,SCH,MEMBER,STUTERATIO' })}`,
  }
}

/** Puts NCES's answers together. An answer that could not be had is passed as null and named in `missing`. */
export function buildSchoolProfile(center: [number, number], answers: { public: unknown; private: unknown | null; college: unknown | null; district: unknown | null }): SchoolProfile {
  const district = answers.district ? readDistrict(answers.district) : null
  const schools = [
    ...readPublic(answers.public, center, district?.id || null),
    ...(answers.private ? readListed(answers.private, center, 'private') : []),
    ...(answers.college ? readListed(answers.college, center, 'college') : []),
  ]
    // The service's circle is measured a little differently, so the edge is trimmed here.
    .filter((school) => school.miles <= SCHOOL_MILES + 0.05)
    .map((school) => ({ ...school, miles: Number(school.miles.toFixed(2)) }))
    .sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name))
  const counts = Object.fromEntries(SCHOOL_KINDS.map((kind) => [kind, schools.filter((school) => school.kind === kind).length])) as Record<SchoolKind, number>
  const missing = [answers.private ? '' : 'private schools', answers.college ? '' : 'colleges', answers.district ? '' : 'the school district'].filter(Boolean)
  return { district, schools, counts, miles: SCHOOL_MILES, missing }
}

/** One question to NCES, kept for a month by Next. Null when it fails or NCES reports an error inside its answer. */
async function ask(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), next: { revalidate: KEEP_SECONDS } } as RequestInit)
    if (!response.ok) return null
    const body = (await response.json()) as { error?: unknown } | null
    if (!body || body.error) {
      console.error('NCES school service refused a request', body?.error)
      return null
    }
    return body
  } catch (error) {
    console.error('Reading schools failed', error)
    return null
  }
}

/** The schools around a point in the United States, and its school district. */
export async function schoolProfile(latitude: number, longitude: number): Promise<SchoolResult> {
  const center: [number, number] = [Number(latitude.toFixed(5)), Number(longitude.toFixed(5))]
  const urls = schoolUrls(center[0], center[1])
  const [publicSchools, privateSchools, colleges, district] = await Promise.all([ask(urls.public), ask(urls.private), ask(urls.college), ask(urls.district)])
  if (!publicSchools) return { ok: false, error: 'The school data service (NCES) could not be reached. Try again in a minute.' }
  return { ok: true, profile: buildSchoolProfile(center, { public: publicSchools, private: privateSchools, college: colleges, district }) }
}
