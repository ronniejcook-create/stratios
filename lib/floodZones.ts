// Flood zones around a point, from FEMA's National Flood Hazard Layer: the
// official flood insurance maps as map data. The service is free and needs no
// account or key. Two questions are asked: which zone the point itself is in,
// and the outlines of every zone within about a mile, for drawing on the map.
//
// Everything except `floodProfile` at the bottom is plain arithmetic and
// reading of answers, so it can be tested without the service.

const ZONES_URL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query'
/** How far out from the point zones are fetched, in miles each way. */
export const FLOOD_MILES = 1
const MILES_PER_DEGREE = 69.05
/** Flood maps change a few times a year at most; an answer is kept for a week. */
const KEEP_SECONDS = 7 * 24 * 60 * 60
const FIELDS = 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,LEN_UNIT,V_DATUM'

/**
 * The groups zones are shown in, most serious first. `minimal` is FEMA's
 * "area of minimal flood hazard" (most land), which is left clear on the map;
 * `none` is open water and land outside the mapped area.
 */
export type FloodKind = 'floodway' | 'coastal' | 'high' | 'moderate' | 'levee' | 'undetermined' | 'minimal' | 'none'
export const FLOOD_KINDS: readonly FloodKind[] = ['floodway', 'coastal', 'high', 'moderate', 'levee', 'undetermined', 'minimal', 'none']

export const FLOOD_LABELS: Record<FloodKind, string> = {
  floodway: 'Floodway',
  coastal: 'High Risk, Coastal',
  high: 'High Risk',
  moderate: 'Moderate Risk',
  levee: 'Reduced Risk Behind a Levee',
  undetermined: 'Not Studied',
  minimal: 'Minimal Risk',
  none: 'Not Mapped',
}

/** One plain sentence on what each group means. */
export const FLOOD_MEANINGS: Record<FloodKind, string> = {
  floodway: 'The channel that has to stay clear to carry a flood. Inside the high-risk area, with the tightest limits on building.',
  coastal: 'A 1% chance of flooding in any year, with added danger from waves. Lenders require flood insurance here.',
  high: 'A 1% chance of flooding in any year (the "100-year flood"). Lenders require flood insurance here.',
  moderate: 'Between the 1% and the 0.2% yearly chance (the "500-year flood"). Flood insurance is not required by FEMA\'s rules.',
  levee: 'Protected from the 1% flood by a levee. Flood insurance is not required by FEMA\'s rules, but the risk depends on the levee.',
  undetermined: 'FEMA has not studied the flood risk here.',
  minimal: 'Outside the 0.2% yearly chance (the "500-year flood"). Flood insurance is not required by FEMA\'s rules.',
  none: 'Open water, or land FEMA\'s map leaves out.',
}

/** A zone as FEMA records it, put into one of the groups. */
export type FloodZone = {
  /** FEMA's zone letters: X, AE, VE and so on. */
  zone: string
  /** FEMA's own wording of the zone's subtype, tidied to ordinary capitals; empty when there is none. */
  detail: string
  kind: FloodKind
  /** Inside a Special Flood Hazard Area: where lenders must require flood insurance. */
  special: boolean
  /** The flood height FEMA gives for the whole zone, as written ("512 ft"), when it gives one. */
  elevation: string | null
}
/** A zone's shape for the map: rings of [latitude, longitude]. */
export type FloodArea = FloodZone & { id: string; outline: [number, number][][] }

export type FloodProfile = {
  /** The zone the point is in; null when FEMA has no map data there. */
  at: FloodZone | null
  /** Zones within about a mile, minimal risk and unmapped land left out. */
  areas: FloodArea[]
  /** Which groups appear among the areas, most serious first. */
  kinds: FloodKind[]
  miles: number
  /** True when FEMA cut its answer short, so some outlines may be missing. */
  partial: boolean
}
export type FloodResult = { ok: true; profile: FloodProfile } | { ok: false; error: string }

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** "AREA OF MINIMAL FLOOD HAZARD" -> "Area of minimal flood hazard"; "0.2 PCT" -> "0.2%". */
function tidy(subtype: string): string {
  // FEMA sometimes writes an empty subtype as the word "<Null>".
  if (!subtype || /^<null>$/i.test(subtype)) return ''
  const lower = subtype.toLowerCase().replace(/\s*pct\b/g, '%')
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** Which group a zone belongs to, from FEMA's zone letters, subtype and special-area flag. */
export function classify(zone: string, subtype: string, special: boolean): FloodKind {
  const letters = zone.toUpperCase()
  const sub = subtype.toUpperCase()
  if (letters === 'OPEN WATER' || letters === 'AREA NOT INCLUDED' || letters === '') return 'none'
  // Zone X is everything outside the high-risk area; its subtype says how far outside.
  if (letters === 'X' || letters.startsWith('X ')) {
    if (sub.includes('LEVEE') || letters.includes('LEVEE')) return 'levee'
    if (/0\.2 ?PCT|1 PCT|FUTURE CONDITIONS/.test(sub)) return 'moderate'
    return 'minimal'
  }
  if (letters === 'D') return 'undetermined'
  if (sub.includes('FLOODWAY')) return 'floodway'
  if (letters.startsWith('V')) return 'coastal'
  if (letters.startsWith('A') || special) return 'high'
  return 'undetermined'
}

/** Reads one zone from the fields FEMA sends with it. */
export function readZone(fields: unknown): FloodZone | null {
  if (!fields || typeof fields !== 'object') return null
  const row = fields as Record<string, unknown>
  const zone = text(row.FLD_ZONE)
  const subtype = text(row.ZONE_SUBTY)
  const kind = classify(zone, subtype, text(row.SFHA_TF).toUpperCase() === 'T')
  const height = typeof row.STATIC_BFE === 'number' && row.STATIC_BFE > -9000 ? row.STATIC_BFE : null
  // FEMA writes "no value" as -9999, and the unit and datum as words or as "NP" (not populated).
  const unit = /^met/i.test(text(row.LEN_UNIT)) ? 'm' : 'ft'
  const datum = text(row.V_DATUM)
  return {
    zone,
    detail: tidy(subtype),
    kind,
    // FEMA's own flag is wrong on a few Zone X records, so it follows the group instead.
    special: kind === 'floodway' || kind === 'coastal' || kind === 'high',
    elevation: height === null ? null : `${Number(height.toFixed(1)).toLocaleString('en-US')} ${unit}${datum && datum.toUpperCase() !== 'NP' ? ` (${datum})` : ''}`,
  }
}

const rank = (zone: FloodZone) => FLOOD_KINDS.indexOf(zone.kind)

/** The zone at the point, from FEMA's answer to the point question. Overlapping zones give the most serious. */
export function readPoint(body: unknown): FloodZone | null {
  const features = (body as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) return null
  const zones = features.map((feature) => readZone((feature as { attributes?: unknown } | null)?.attributes)).filter((zone): zone is FloodZone => zone !== null)
  return zones.sort((a, b) => rank(a) - rank(b))[0] ?? null
}

const ring = (points: unknown): [number, number][] =>
  Array.isArray(points)
    ? points.flatMap((point) => (Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number' ? [[point[1], point[0]] as [number, number]] : []))
    : []

/** The zones to draw, from FEMA's answer to the area question (GeoJSON). Minimal risk and unmapped land are dropped. */
export function readAreas(body: unknown): { areas: FloodArea[]; partial: boolean } {
  const answer = body as { features?: unknown; exceededTransferLimit?: unknown; properties?: { exceededTransferLimit?: unknown } } | null
  const features = Array.isArray(answer?.features) ? answer.features : []
  const areas: FloodArea[] = []
  for (const [index, entry] of features.entries()) {
    const feature = entry as { properties?: unknown; geometry?: { type?: unknown; coordinates?: unknown } | null } | null
    const zone = readZone(feature?.properties)
    if (!zone || zone.kind === 'minimal' || zone.kind === 'none') continue
    const shape = feature?.geometry
    // A zone can be one piece of land or several; each piece is drawn on its own.
    const pieces = shape?.type === 'Polygon' ? [shape.coordinates] : shape?.type === 'MultiPolygon' && Array.isArray(shape.coordinates) ? shape.coordinates : []
    for (const [part, piece] of pieces.entries()) {
      const outline = (Array.isArray(piece) ? piece : []).map(ring).filter((points) => points.length >= 3)
      if (outline.length > 0) areas.push({ ...zone, id: `${index}-${part}`, outline })
    }
  }
  // The most serious zones are drawn last, so they sit on top where shapes overlap.
  areas.sort((a, b) => rank(b) - rank(a))
  return { areas, partial: answer?.exceededTransferLimit === true || answer?.properties?.exceededTransferLimit === true }
}

/** The two questions to ask FEMA about a point: the zone at it, and the zones around it. */
export function floodUrls(latitude: number, longitude: number): { point: string; area: string } {
  const lat = Number(latitude.toFixed(5))
  const lng = Number(longitude.toFixed(5))
  const up = FLOOD_MILES / MILES_PER_DEGREE
  const across = up / Math.max(0.2, Math.cos((lat * Math.PI) / 180))
  const shared = { inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: FIELDS }
  const point = new URLSearchParams({ ...shared, geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', returnGeometry: 'false', f: 'json' })
  const area = new URLSearchParams({
    ...shared,
    geometry: [lng - across, lat - up, lng + across, lat + up].map((value) => value.toFixed(5)).join(','),
    geometryType: 'esriGeometryEnvelope',
    returnGeometry: 'true',
    outSR: '4326',
    // Outlines simplified to about five yards: flood lines are fine-grained, so less than the census outlines.
    maxAllowableOffset: '0.00005',
    geometryPrecision: '5',
    f: 'geojson',
  })
  return { point: `${ZONES_URL}?${point}`, area: `${ZONES_URL}?${area}` }
}

/** Puts FEMA's two answers together. */
export function buildFloodProfile(pointBody: unknown, areaBody: unknown): FloodProfile {
  const { areas, partial } = readAreas(areaBody)
  const present = new Set(areas.map((area) => area.kind))
  return { at: readPoint(pointBody), areas, kinds: FLOOD_KINDS.filter((kind) => present.has(kind)), miles: FLOOD_MILES, partial }
}

/** A fetch whose answer Next keeps for a week. The options are Next's own addition to fetch. */
const kept = (url: string, timeoutMs: number) => fetch(url, { signal: AbortSignal.timeout(timeoutMs), next: { revalidate: KEEP_SECONDS } } as RequestInit)

/** FEMA's flood zones at and around a point in the United States. */
export async function floodProfile(latitude: number, longitude: number): Promise<FloodResult> {
  const urls = floodUrls(latitude, longitude)
  try {
    const [point, area] = await Promise.all([kept(urls.point, 20000), kept(urls.area, 25000)])
    if (!point.ok || !area.ok) return { ok: false, error: "FEMA's flood map service is not answering right now. Try again in a minute." }
    const [pointBody, areaBody] = (await Promise.all([point.json(), area.json()])) as [{ error?: unknown } | null, { error?: unknown } | null]
    // The service reports its own failures inside an ordinary answer.
    if (pointBody?.error || areaBody?.error) {
      console.error('FEMA flood service refused a request', pointBody?.error ?? areaBody?.error)
      return { ok: false, error: "FEMA's flood map service could not answer for this spot. Try again in a minute." }
    }
    return { ok: true, profile: buildFloodProfile(pointBody, areaBody) }
  } catch (error) {
    console.error('Reading flood zones failed', error)
    return { ok: false, error: "FEMA's flood map service could not be reached. Try again in a minute." }
  }
}
