// Jobs and commuting around a point, from two federal sources:
//
// - **Jobs** come from the EPA's Smart Location Database (version 3), which
//   gives, for every census block group (a few blocks, smaller than a tract):
//   how many jobs are located there and of what kind, how many workers live
//   there, how many jobs can be reached in 45 minutes by car and by transit,
//   and a walkability score. Its map service is free and needs no key.
//   **Its job counts are from 2017** (the Census Bureau's employer records for
//   that year), so they predate the pandemic. The Census Bureau's own newer
//   counts are published only as bulk files with no lookup service.
// - **Commuting** comes from the Census Bureau's American Community Survey for
//   the census tract the point is in: how the people who live there get to
//   work and how long it takes. It uses the same free key as the demographics
//   (CENSUS_API_KEY) and is simply left out when that is missing or fails.
//
// The database also carries residents' wages, race and sex per block group.
// None of that is requested: the tab is about the job market around a
// property, not about who lives beside it.
//
// Everything except `jobsProfile` at the bottom is plain arithmetic and
// reading of answers, so it can be tested without the services.

import { censusKey } from './demographics'

const SLD_URL = 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/ArcGIS/rest/services/Smart_Location_Database_/FeatureServer/0/query'
const TRACTS_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query'
const DATA_URL = 'https://api.census.gov/data'
/** The survey to ask for first, then the one before it. Each covers five years ending in its year. */
const SURVEY_YEARS = [2024, 2023]
/** The year of the database's job counts. */
export const JOBS_YEAR = 2017

/** How far out block groups are fetched and totaled. */
export const JOBS_MILES = 3
/** The distances jobs are totaled within. */
export const JOB_RINGS = [1, 3] as const
const METERS_PER_MILE = 1609.344
/** Neither source changes more than once a year; an answer is kept for a month. */
const KEEP_SECONDS = 30 * 24 * 60 * 60

/** The database's eight kinds of job, with its field for each. */
export const JOB_SECTORS = [
  { key: 'office', label: 'Office', field: 'E8_off' },
  { key: 'service', label: 'Service', field: 'E8_Svc' },
  { key: 'retail', label: 'Retail', field: 'E8_Ret' },
  { key: 'health', label: 'Health Care', field: 'E8_Hlth' },
  { key: 'education', label: 'Education', field: 'E8_Ed' },
  { key: 'entertainment', label: 'Entertainment, Lodging and Food', field: 'E8_Ent' },
  { key: 'industrial', label: 'Industrial', field: 'E8_Ind' },
  { key: 'public', label: 'Public Administration', field: 'E8_Pub' },
] as const
export type JobSector = (typeof JOB_SECTORS)[number]['key']

/** One block group for the map. */
export type JobArea = { id: string; outline: [number, number][][]; jobs: number; jobsPerAcre: number | null; workers: number }
/** Totals for the block groups whose middle falls within a distance. */
export type JobRing = { miles: number; jobs: number; workers: number; sectors: Record<JobSector, number> }

/** How the residents of the tract get to work, as shares of all workers (0 to 1), and their average trip. */
export type Commute = {
  survey: string
  workers: number
  droveAlone: number
  carpooled: number
  transit: number
  walkedOrBiked: number
  workedFromHome: number
  other: number
  /** Average one-way minutes for those who travel to work; null when the survey gives none for the tract. */
  minutes: number | null
}

export type JobsProfile = {
  /** The block group the point is in; null when the database has nothing there. */
  at: {
    metro: string
    /** Jobs reachable within 45 minutes, nearer jobs counting for more; null when not worked out for this place. */
    jobsByCar: number | null
    jobsByTransit: number | null
    /** The EPA's walkability score, 1 (least) to 20 (most), with its band. */
    walkability: number | null
    walkabilityBand: string | null
  } | null
  rings: JobRing[]
  areas: JobArea[]
  commute: Commute | null
  miles: number
  jobsYear: number
  /** Parts that could not be loaded this time. */
  missing: string[]
}
export type JobsResult = { ok: true; profile: JobsProfile } | { ok: false; error: string }

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
/** A count from the database; it writes "not available" as a large negative number. */
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
const known = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

/** Straight-line miles between two points given as [latitude, longitude]. */
export function milesApart(a: [number, number], b: [number, number]): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = radians(b[0] - a[0])
  const dLng = radians(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The EPA's own bands for its walkability score. */
export function walkabilityBand(score: number): string {
  if (score <= 5.75) return 'Least Walkable'
  if (score <= 10.5) return 'Below Average'
  if (score <= 15.25) return 'Above Average'
  return 'Most Walkable'
}

/** The block group at the point, from the database's answer. */
export function readBlockGroup(body: unknown): JobsProfile['at'] {
  const features = (body as { features?: unknown } | null)?.features
  const row = Array.isArray(features) ? ((features[0] as { attributes?: Record<string, unknown> } | undefined)?.attributes ?? null) : null
  if (!row) return null
  const walkability = known(row.NatWalkInd)
  return {
    metro: text(row.CBSA_Name),
    jobsByCar: known(row.D5AR),
    jobsByTransit: known(row.D5BR),
    walkability: walkability === null || walkability < 1 ? null : Number(walkability.toFixed(1)),
    walkabilityBand: walkability === null || walkability < 1 ? null : walkabilityBand(walkability),
  }
}

const ring = (points: unknown): [number, number][] =>
  Array.isArray(points)
    ? points.flatMap((point) => (Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number' ? [[point[1], point[0]] as [number, number]] : []))
    : []

/** The middle of a shape, near enough for deciding which ring it belongs to: the average of its outer corners. */
function middle(outline: [number, number][][]): [number, number] {
  const points = outline[0] ?? []
  const sum = points.reduce((total, point) => [total[0] + point[0], total[1] + point[1]] as [number, number], [0, 0] as [number, number])
  return points.length > 0 ? [sum[0] / points.length, sum[1] / points.length] : [0, 0]
}

/** The block groups nearby, from the database's answer (GeoJSON), and the totals within each distance. */
export function readBlockGroups(body: unknown, center: [number, number]): { areas: JobArea[]; rings: JobRing[] } {
  const features = (body as { features?: unknown } | null)?.features
  const areas: JobArea[] = []
  const rings: JobRing[] = JOB_RINGS.map((miles) => ({ miles, jobs: 0, workers: 0, sectors: Object.fromEntries(JOB_SECTORS.map((sector) => [sector.key, 0])) as Record<JobSector, number> }))
  for (const [index, entry] of (Array.isArray(features) ? features : []).entries()) {
    const feature = entry as { properties?: Record<string, unknown>; geometry?: { type?: unknown; coordinates?: unknown } | null } | null
    const row = feature?.properties ?? {}
    const shape = feature?.geometry
    const pieces = shape?.type === 'Polygon' ? [shape.coordinates] : shape?.type === 'MultiPolygon' && Array.isArray(shape.coordinates) ? shape.coordinates : []
    const outlines = pieces.map((piece) => (Array.isArray(piece) ? piece : []).map(ring).filter((points) => points.length >= 3)).filter((outline) => outline.length > 0)
    if (outlines.length === 0) continue
    const jobs = count(row.TotEmp)
    const workers = count(row.Workers)
    const acres = known(row.Ac_Land)
    const id = text(row.GEOID20) || text(row.GEOID10) || String(index)
    for (const [part, outline] of outlines.entries()) {
      areas.push({ id: `${id}-${part}`, outline, jobs, jobsPerAcre: acres !== null && acres > 0 ? Number((jobs / acres).toFixed(2)) : null, workers })
    }
    // A block group counts toward a distance when its middle is within it (its largest piece decides).
    const largest = outlines.reduce((best, outline) => (outline[0].length > best[0].length ? outline : best), outlines[0])
    const away = milesApart(center, middle(largest))
    for (const total of rings) {
      if (away > total.miles) continue
      total.jobs += jobs
      total.workers += workers
      for (const sector of JOB_SECTORS) total.sectors[sector.key] += count(row[sector.field])
    }
  }
  return { areas, rings }
}

/** The two questions to ask the database about a point. */
export function jobsUrls(latitude: number, longitude: number): { blockGroup: string; blockGroups: string } {
  const at = { where: '1=1', geometry: `${longitude.toFixed(5)},${latitude.toFixed(5)}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' }
  return {
    blockGroup: `${SLD_URL}?${new URLSearchParams({ ...at, outFields: 'GEOID20,CBSA_Name,D5AR,D5BR,NatWalkInd', returnGeometry: 'false', f: 'json' })}`,
    blockGroups: `${SLD_URL}?${new URLSearchParams({
      ...at,
      distance: String(Math.round(JOBS_MILES * METERS_PER_MILE)),
      units: 'esriSRUnit_Meter',
      outFields: ['GEOID10', 'GEOID20', 'TotEmp', 'Workers', 'Ac_Land', ...JOB_SECTORS.map((sector) => sector.field)].join(','),
      returnGeometry: 'true',
      outSR: '4326',
      // Outlines simplified to about 30 yards, as for the census neighborhoods.
      maxAllowableOffset: '0.0003',
      geometryPrecision: '5',
      f: 'geojson',
    })}`,
  }
}

/** The survey's counts asked for: workers by how they get to work, and the minutes they spend. */
const COMMUTE_VARIABLES = {
  workers: 'B08301_001E',
  droveAlone: 'B08301_003E',
  carpooled: 'B08301_004E',
  transit: 'B08301_010E',
  bicycle: 'B08301_018E',
  walked: 'B08301_019E',
  workedFromHome: 'B08301_021E',
  travelers: 'B08303_001E',
  totalMinutes: 'B08013_001E',
} as const

/** Reads the survey's answer for one tract (a header row, then one row of figures). The survey marks a missing figure with a large negative number. */
export function readCommute(body: unknown, survey: string): Commute | null {
  if (!Array.isArray(body) || !Array.isArray(body[0]) || !Array.isArray(body[1])) return null
  const header = body[0] as unknown[]
  const row = body[1] as unknown[]
  const figure = (name: keyof typeof COMMUTE_VARIABLES) => {
    const value = Number(row[header.indexOf(COMMUTE_VARIABLES[name])])
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  const workers = figure('workers')
  if (!workers) return null
  const share = (value: number | null) => (value ?? 0) / workers
  const droveAlone = share(figure('droveAlone'))
  const carpooled = share(figure('carpooled'))
  const transit = share(figure('transit'))
  const walkedOrBiked = share((figure('walked') ?? 0) + (figure('bicycle') ?? 0))
  const workedFromHome = share(figure('workedFromHome'))
  const travelers = figure('travelers')
  const totalMinutes = figure('totalMinutes')
  return {
    survey,
    workers,
    droveAlone,
    carpooled,
    transit,
    walkedOrBiked,
    workedFromHome,
    other: Math.max(0, 1 - droveAlone - carpooled - transit - walkedOrBiked - workedFromHome),
    minutes: travelers && totalMinutes ? Math.round(totalMinutes / travelers) : null,
  }
}

/** Puts the answers together. The second database answer and the commute may be null when they could not be had. */
export function buildJobsProfile(center: [number, number], blockGroup: unknown, blockGroups: unknown | null, commute: Commute | null, commuteNote: string | null = null): JobsProfile {
  const { areas, rings } = blockGroups ? readBlockGroups(blockGroups, center) : { areas: [], rings: [] }
  return {
    at: readBlockGroup(blockGroup),
    rings,
    areas,
    commute,
    miles: JOBS_MILES,
    jobsYear: JOBS_YEAR,
    missing: [blockGroups ? '' : 'the jobs in the surrounding area', commute ? '' : commuteNote ?? 'the commuting figures'].filter(Boolean),
  }
}

async function ask(url: string, timeoutMs: number): Promise<unknown | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), next: { revalidate: KEEP_SECONDS } } as RequestInit)
    if (!response.ok) return null
    const body = (await response.json()) as { error?: unknown } | null
    if (!body || (!Array.isArray(body) && body.error)) return null
    return body
  } catch (error) {
    // Never log the address asked for: the survey's carries the key.
    console.error('A jobs and commuting lookup failed', error instanceof Error ? error.name : 'error')
    return null
  }
}

/** How the residents of the tract at a point get to work; null (with a reason) when it can't be had. */
async function commuteAt(latitude: number, longitude: number): Promise<{ commute: Commute | null; note: string | null }> {
  const key = censusKey()
  if (!key) return { commute: null, note: 'the commuting figures (the Census key, CENSUS_API_KEY, is not set)' }
  const where = new URLSearchParams({ geometry: `${longitude.toFixed(5)},${latitude.toFixed(5)}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'STATE,COUNTY,TRACT', returnGeometry: 'false', f: 'json' })
  const found = (await ask(`${TRACTS_URL}?${where}`, 15000)) as { features?: { attributes?: Record<string, unknown> }[] } | null
  const tract = found?.features?.[0]?.attributes
  const state = String(tract?.STATE ?? '')
  const county = String(tract?.COUNTY ?? '')
  const code = String(tract?.TRACT ?? '')
  if (!/^\d{2}$/.test(state) || !/^\d{3}$/.test(county) || !/^\d{6}$/.test(code)) return { commute: null, note: null }
  const variables = Object.values(COMMUTE_VARIABLES).join(',')
  for (const year of SURVEY_YEARS) {
    const body = await ask(`${DATA_URL}/${year}/acs/acs5?get=${variables}&for=tract:${code}&in=state:${state}%20county:${county}&key=${encodeURIComponent(key)}`, 15000)
    const commute = readCommute(body, `${year - 4} to ${year}`)
    if (commute) return { commute, note: null }
  }
  return { commute: null, note: null }
}

/** The jobs around a point in the United States, and how the people living there get to work. */
export async function jobsProfile(latitude: number, longitude: number): Promise<JobsResult> {
  const center: [number, number] = [Number(latitude.toFixed(5)), Number(longitude.toFixed(5))]
  const urls = jobsUrls(center[0], center[1])
  const [blockGroup, blockGroups, commuting] = await Promise.all([ask(urls.blockGroup, 20000), ask(urls.blockGroups, 25000), commuteAt(center[0], center[1])])
  if (!blockGroup) return { ok: false, error: "The EPA's jobs data service could not be reached. Try again in a minute." }
  return { ok: true, profile: buildJobsProfile(center, blockGroup, blockGroups, commuting.commute, commuting.note) }
}
