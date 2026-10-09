// Natural hazard ratings around a point, from FEMA's National Risk Index. The
// index rates every census tract in the country for eighteen natural hazards.
// Its map service is free and needs no account or key. Two questions are
// asked: the ratings of the tract the point is in, and the ratings and
// outlines of the tracts within a few miles, for shading the map.
//
// What is used, and what is deliberately not. The index publishes three
// things per tract: Expected Annual Loss (how much damage the hazards are
// expected to do in a year, from how often they happen and what is there to
// be damaged), Social Vulnerability and Community Resilience (both built from
// who lives there: income, age, race, language and the like), and a Risk
// rating that combines all three. Only **Expected Annual Loss** is read here.
// It is the part about the hazards themselves, and ratings built on who lives
// in a neighborhood have no place in leasing or lending decisions.
//
// Ratings are relative: "Relatively High" means high next to other tracts in
// the country, not a forecast for one building.
//
// Everything except `hazardProfile` at the bottom is plain reading of answers,
// so it can be tested without the service.

const TRACTS_URL = 'https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Census_Tracts/FeatureServer/0/query'
/** How far out neighboring tracts are fetched for the map. */
export const HAZARD_MILES = 3
const METERS_PER_MILE = 1609.344
/** The index is revised about once a year; an answer is kept for a month. */
const KEEP_SECONDS = 30 * 24 * 60 * 60

/** The eighteen hazards, by the short codes the index uses in its field names. */
export const HAZARDS = [
  { key: 'AVLN', label: 'Avalanche' },
  { key: 'CFLD', label: 'Coastal Flooding' },
  { key: 'CWAV', label: 'Cold Wave' },
  { key: 'DRGT', label: 'Drought' },
  { key: 'ERQK', label: 'Earthquake' },
  { key: 'HAIL', label: 'Hail' },
  { key: 'HWAV', label: 'Heat Wave' },
  { key: 'HRCN', label: 'Hurricane' },
  { key: 'ISTM', label: 'Ice Storm' },
  { key: 'IFLD', label: 'Inland Flooding' },
  { key: 'LNDS', label: 'Landslide' },
  { key: 'LTNG', label: 'Lightning' },
  { key: 'SWND', label: 'Strong Wind' },
  { key: 'TRND', label: 'Tornado' },
  { key: 'TSUN', label: 'Tsunami' },
  { key: 'VLCN', label: 'Volcanic Activity' },
  { key: 'WFIR', label: 'Wildfire' },
  { key: 'WNTW', label: 'Winter Weather' },
] as const
export type HazardKey = (typeof HAZARDS)[number]['key']
/** What the map can be shaded by: all hazards together, or one of them. */
export type HazardChoice = 'ALL' | HazardKey
export const HAZARD_CHOICES: readonly HazardChoice[] = ['ALL', ...HAZARDS.map((hazard) => hazard.key)]
export const hazardLabel = (choice: HazardChoice) => (choice === 'ALL' ? 'All Hazards Together' : HAZARDS.find((hazard) => hazard.key === choice)?.label ?? choice)

/** The index's five ratings, lowest first. A rating's place in this list is its level, 0 to 4. */
export const HAZARD_RATINGS = ['Very Low', 'Relatively Low', 'Relatively Moderate', 'Relatively High', 'Very High'] as const

/** The level 0 to 4 of a rating as the index writes it; -1 for "Not Applicable", "No Rating", "Insufficient Data" and the like. */
export function levelOf(rating: unknown): number {
  return typeof rating === 'string' ? HAZARD_RATINGS.findIndex((entry) => entry.toLowerCase() === rating.trim().toLowerCase()) : -1
}

export type HazardRating = {
  key: HazardChoice
  label: string
  /** 0 (very low) to 4 (very high). */
  level: number
  /** The share of U.S. census tracts this one is rated higher than, 0 to 100; null when the index gives none. */
  higherThan: number | null
}

/** One tract for the map: its outline, and its level for each choice in the order of `HAZARD_CHOICES` (-1 for none). */
export type HazardArea = { id: string; name: string; outline: [number, number][][]; levels: number[] }

export type HazardProfile = {
  /** The tract the point is in; null when the index has nothing there. */
  at: { tract: string; county: string; state: string; overall: HazardRating | null; hazards: HazardRating[] } | null
  areas: HazardArea[]
  miles: number
  /** The edition of the index, as it names itself ("December 2025"). */
  version: string | null
  /** True when the neighboring tracts could not be loaded, so the map has nothing to shade. */
  noMap: boolean
}
export type HazardResult = { ok: true; profile: HazardProfile } | { ok: false; error: string }

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const share = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null)

/** The index's field names for a choice: its rating and its score (a national percentile). */
const ratingField = (choice: HazardChoice) => (choice === 'ALL' ? 'EAL_RATNG' : `${choice}_EALR`)
const scoreField = (choice: HazardChoice) => (choice === 'ALL' ? 'EAL_SCORE' : `${choice}_EALS`)

/** "013620" -> "136.20", the way census tracts are usually written. */
export function tractName(code: unknown): string {
  const digits = text(code).replace(/\D/g, '')
  if (digits.length !== 6) return text(code)
  const whole = String(Number(digits.slice(0, 4)))
  return digits.slice(4) === '00' ? whole : `${whole}.${digits.slice(4)}`
}

function ratingOf(row: Record<string, unknown>, choice: HazardChoice): HazardRating | null {
  const level = levelOf(row[ratingField(choice)])
  return level < 0 ? null : { key: choice, label: hazardLabel(choice), level, higherThan: share(row[scoreField(choice)]) }
}

/** The tract at the point, from the service's answer: its overall rating, and each hazard that applies there, most serious first. */
export function readTract(body: unknown): { at: HazardProfile['at']; version: string | null } {
  const features = (body as { features?: unknown } | null)?.features
  const row = Array.isArray(features) ? ((features[0] as { attributes?: Record<string, unknown> } | undefined)?.attributes ?? null) : null
  if (!row) return { at: null, version: null }
  const hazards = HAZARDS.map((hazard) => ratingOf(row, hazard.key))
    .filter((rating): rating is HazardRating => rating !== null)
    .sort((a, b) => b.level - a.level || (b.higherThan ?? 0) - (a.higherThan ?? 0) || a.label.localeCompare(b.label))
  return {
    at: { tract: tractName(row.TRACT), county: [text(row.COUNTY), text(row.COUNTYTYPE)].filter(Boolean).join(' '), state: text(row.STATEABBRV), overall: ratingOf(row, 'ALL'), hazards },
    version: text(row.NRI_VER) || null,
  }
}

const ring = (points: unknown): [number, number][] =>
  Array.isArray(points)
    ? points.flatMap((point) => (Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number' ? [[point[1], point[0]] as [number, number]] : []))
    : []

/** The neighboring tracts, from the service's answer (GeoJSON). A tract in several pieces is drawn piece by piece. */
export function readAreas(body: unknown): HazardArea[] {
  const features = (body as { features?: unknown } | null)?.features
  const areas: HazardArea[] = []
  for (const entry of Array.isArray(features) ? features : []) {
    const feature = entry as { properties?: Record<string, unknown>; geometry?: { type?: unknown; coordinates?: unknown } | null } | null
    const row = feature?.properties ?? {}
    const shape = feature?.geometry
    const pieces = shape?.type === 'Polygon' ? [shape.coordinates] : shape?.type === 'MultiPolygon' && Array.isArray(shape.coordinates) ? shape.coordinates : []
    const levels = HAZARD_CHOICES.map((choice) => levelOf(row[ratingField(choice)]))
    for (const [part, piece] of pieces.entries()) {
      const outline = (Array.isArray(piece) ? piece : []).map(ring).filter((points) => points.length >= 3)
      if (outline.length > 0) areas.push({ id: `${text(row.TRACTFIPS)}-${part}`, name: `Census Tract ${tractName(row.TRACT)}`, outline, levels })
    }
  }
  return areas
}

/** The two questions to ask the service about a point. */
export function hazardUrls(latitude: number, longitude: number): { tract: string; areas: string } {
  const at = { where: '1=1', geometry: `${longitude.toFixed(5)},${latitude.toFixed(5)}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' }
  const ratings = HAZARD_CHOICES.map(ratingField)
  return {
    tract: `${TRACTS_URL}?${new URLSearchParams({ ...at, outFields: ['TRACT', 'COUNTY', 'COUNTYTYPE', 'STATEABBRV', 'NRI_VER', ...ratings, ...HAZARD_CHOICES.map(scoreField)].join(','), returnGeometry: 'false', f: 'json' })}`,
    areas: `${TRACTS_URL}?${new URLSearchParams({
      ...at,
      distance: String(Math.round(HAZARD_MILES * METERS_PER_MILE)),
      units: 'esriSRUnit_Meter',
      outFields: ['TRACT', 'TRACTFIPS', ...ratings].join(','),
      returnGeometry: 'true',
      outSR: '4326',
      // Outlines simplified to about 30 yards, as for the census neighborhoods.
      maxAllowableOffset: '0.0003',
      geometryPrecision: '5',
      f: 'geojson',
    })}`,
  }
}

/** Puts the service's two answers together; the second may be null when it could not be had. */
export function buildHazardProfile(tractBody: unknown, areasBody: unknown | null): HazardProfile {
  const { at, version } = readTract(tractBody)
  return { at, areas: areasBody ? readAreas(areasBody) : [], miles: HAZARD_MILES, version, noMap: !areasBody }
}

async function ask(url: string, timeoutMs: number): Promise<unknown | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), next: { revalidate: KEEP_SECONDS } } as RequestInit)
    if (!response.ok) return null
    const body = (await response.json()) as { error?: unknown } | null
    if (!body || body.error) {
      console.error('National Risk Index service refused a request', body?.error)
      return null
    }
    return body
  } catch (error) {
    console.error('Reading natural hazards failed', error)
    return null
  }
}

/** FEMA's natural hazard ratings at and around a point in the United States. */
export async function hazardProfile(latitude: number, longitude: number): Promise<HazardResult> {
  const urls = hazardUrls(latitude, longitude)
  const [tract, areas] = await Promise.all([ask(urls.tract, 20000), ask(urls.areas, 25000)])
  if (!tract) return { ok: false, error: "FEMA's National Risk Index service could not be reached. Try again in a minute." }
  return { ok: true, profile: buildHazardProfile(tract, areas) }
}
