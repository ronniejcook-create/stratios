// Public transit around a point, from the National Transit Map: the stops and
// routes that transit agencies publish and the U.S. Department of
// Transportation (Bureau of Transportation Statistics) gathers into one
// national set. Its map services are free and need no account or key.
//
// Five questions are asked: every stop within walking distance, the rail
// stations further out, the routes that pass within walking distance, which
// rail lines run further out, and then the shapes of those lines for drawing.
// (Asking for every rail shape in one go takes over twenty seconds in a city
// like New York, where each line is stored as dozens of shapes; picking one
// shape per line first keeps it to a second or two.)
//
// Limits worth knowing: agencies take part by choice, so a small system may be
// missing; it is local transit only (no Amtrak or intercity buses); and it
// says where service runs, not how often.
//
// Everything except `transitProfile` at the bottom is plain arithmetic and
// reading of answers, so it can be tested without the service.

const BASE = 'https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services'
const STOPS_URL = `${BASE}/NTAD_National_Transit_Map_Stops/FeatureServer/0/query`
const ROUTES_URL = `${BASE}/NTAD_National_Transit_Map_Routes/FeatureServer/0/query`

/** Walking distance: every stop and route this close is counted. */
export const WALK_MILES = 0.5
/** How far out rail stations and rail lines are looked for. */
export const RAIL_MILES = 3
const METERS_PER_MILE = 1609.344
/** The national set is refreshed a few times a year; an answer is kept for a month. */
const KEEP_SECONDS = 30 * 24 * 60 * 60
/** The most rail lines drawn, so a big city's subway doesn't swamp the map. */
const MAX_LINES = 60

/** The groups transit is shown in, the heaviest kind of service first. */
export type TransitKind = 'rail' | 'subway' | 'lightRail' | 'ferry' | 'bus' | 'other'
export const TRANSIT_KINDS: readonly TransitKind[] = ['rail', 'subway', 'lightRail', 'ferry', 'bus', 'other']
export const TRANSIT_LABELS: Record<TransitKind, string> = {
  rail: 'Rail',
  subway: 'Subway or Metro',
  lightRail: 'Light Rail or Streetcar',
  ferry: 'Ferry',
  bus: 'Bus',
  other: 'Other',
}
/** The kinds that run on track. */
const ON_TRACK: readonly TransitKind[] = ['rail', 'subway', 'lightRail']
export const isRail = (kind: TransitKind) => ON_TRACK.includes(kind)

/**
 * The service's codes for kinds of transit (the ones transit agencies use in
 * their published schedules): 0 tram or light rail, 1 subway, 2 rail, 3 bus,
 * 4 ferry, 5 cable tram, 6 aerial lift, 7 funicular, 11 trolleybus, 12 monorail.
 */
const KIND_OF_CODE: Record<string, TransitKind> = { '0': 'lightRail', '1': 'subway', '2': 'rail', '3': 'bus', '4': 'ferry', '5': 'lightRail', '6': 'other', '7': 'lightRail', '11': 'bus', '12': 'lightRail' }
const RAIL_CODES = ['0', '1', '2', '5', '7', '12']

/** A stop can serve several kinds ("2;3"); it is shown as the heaviest of them. */
export function kindOf(codes: unknown): TransitKind {
  const kinds = String(typeof codes === 'string' ? codes : '').split(';').map((code) => KIND_OF_CODE[code.trim()]).filter(Boolean)
  return TRANSIT_KINDS.find((kind) => kinds.includes(kind)) ?? 'other'
}

export type TransitStop = { id: string; name: string; kind: TransitKind; latitude: number; longitude: number; miles: number }
export type TransitRoute = { id: string; kind: TransitKind; number: string; name: string; agency: string }
/** A rail line's shape for the map: one or more runs of [latitude, longitude]. */
export type TransitLine = { id: string; kind: TransitKind; label: string; path: [number, number][][] }

export type TransitProfile = {
  /** Every stop within walking distance, plus rail stations out to the rail distance; nearest first. */
  stops: TransitStop[]
  nearestRail: TransitStop | null
  nearestBus: TransitStop | null
  /** How many stops of each kind are within walking distance. */
  walkCounts: Record<TransitKind, number>
  /** Routes that pass within walking distance, rail first. */
  routes: TransitRoute[]
  lines: TransitLine[]
  walkMiles: number
  railMiles: number
  /** The date the agencies' schedules were last gathered, as the service gives it. */
  asOf: string | null
  /** True when a big city has more routes or lines than the service sends at once, so some are left out. */
  partial: boolean
  /** Parts that could not be loaded this time. */
  missing: string[]
}
export type TransitResult = { ok: true; profile: TransitProfile } | { ok: false; error: string }

const text = (value: unknown) => (typeof value === 'string' && value.trim().toLowerCase() !== 'null' ? value.trim() : '')

/** Straight-line miles between two points given as [latitude, longitude]. */
export function milesApart(a: [number, number], b: [number, number]): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = radians(b[0] - a[0])
  const dLng = radians(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** "KNOLL TRAIL @ ARAPAHO - S - MB" -> "Knoll Trail @ Arapaho - S - MB". A name that already has small letters is left as written. */
export function tidyTransitName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim()
  if (!trimmed || /[a-z]/.test(trimmed)) return trimmed
  return trimmed
    .split(' ')
    // One- and two-letter words are directions and codes (N, SW, MB), which stay in capitals.
    .map((word) => (word.length <= 2 || /\d/.test(word) ? word : word.toLowerCase().replace(/(^|[-'/.(&])([a-z])/g, (whole, lead: string, letter: string) => lead + letter.toUpperCase())))
    .join(' ')
    .replace(/'S\b/g, "'s")
}

type Feature = { attributes?: Record<string, unknown>; properties?: Record<string, unknown>; geometry?: { x?: unknown; y?: unknown; type?: unknown; coordinates?: unknown } | null }
const featuresOf = (body: unknown): Feature[] => {
  const features = (body as { features?: unknown } | null)?.features
  return Array.isArray(features) ? (features as Feature[]) : []
}

/** Stops from the service's answer. Station entrances and the like are left out; a station listed with its platforms is one stop. */
export function readStops(body: unknown, center: [number, number]): TransitStop[] {
  const stops: TransitStop[] = []
  for (const feature of featuresOf(body)) {
    const row = feature.attributes ?? {}
    const lat = typeof feature.geometry?.y === 'number' ? feature.geometry.y : Number(row.stop_lat)
    const lng = typeof feature.geometry?.x === 'number' ? feature.geometry.x : Number(row.stop_lon)
    const name = tidyTransitName(text(row.stop_name))
    // Kinds 2, 3 and 4 of place are entrances, walkways inside a station and boarding areas, not stops.
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name || ['2', '3', '4'].includes(text(row.location_type))) continue
    stops.push({ id: `${text(row.ntd_id)}-${text(row.stop_id) || stops.length}`, name, kind: kindOf(row.stop_type), latitude: lat, longitude: lng, miles: milesApart(center, [lat, lng]) })
  }
  return stops
}

/** One of each stop: the same id once, and a rail station listed again for each platform once (same name and kind within about 200 yards). */
export function uniqueStops(stops: TransitStop[]): TransitStop[] {
  const kept: TransitStop[] = []
  const ids = new Set<string>()
  for (const stop of [...stops].sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name))) {
    if (ids.has(stop.id)) continue
    ids.add(stop.id)
    if (isRail(stop.kind) && kept.some((other) => other.kind === stop.kind && other.name === stop.name && milesApart([other.latitude, other.longitude], [stop.latitude, stop.longitude]) < 0.12)) continue
    kept.push(stop)
  }
  return kept
}

/** "227" and "O-CONNOR - LUNA - VALLEY VIEW", tidied; a route with only one of the two uses it as its name. */
function routeNames(row: Record<string, unknown>): { number: string; name: string } {
  const short = text(row.route_short_name)
  const long = tidyTransitName(text(row.route_long_name))
  if (!long || long.toLowerCase() === short.toLowerCase()) return { number: '', name: tidyTransitName(short) || 'Unnamed route' }
  return { number: short, name: long }
}

/** The routes in the service's answer, one of each (a route is listed once per shape), rail first, then by number. */
export function readRoutes(body: unknown): TransitRoute[] {
  const routes = new Map<string, TransitRoute>()
  for (const feature of featuresOf(body)) {
    const row = feature.attributes ?? feature.properties ?? {}
    const id = `${text(row.ntd_id)}-${text(row.route_id)}`
    if (routes.has(id)) continue
    routes.set(id, { id, kind: kindOf(row.route_type), ...routeNames(row), agency: text(row.agency_id) })
  }
  return [...routes.values()].sort(
    (a, b) => TRANSIT_KINDS.indexOf(a.kind) - TRANSIT_KINDS.indexOf(b.kind) || (a.number || a.name).localeCompare(b.number || b.name, 'en', { numeric: true }),
  )
}

const run = (points: unknown): [number, number][] =>
  Array.isArray(points)
    ? points.flatMap((point) => (Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number' ? [[point[1], point[0]] as [number, number]] : []))
    : []

/** Rail lines to draw, from the service's answer (GeoJSON): the first shape of each route. */
export function readLines(body: unknown): TransitLine[] {
  const lines = new Map<string, TransitLine>()
  for (const feature of featuresOf(body)) {
    const row = feature.properties ?? {}
    const id = `${text(row.ntd_id)}-${text(row.route_id)}`
    if (lines.has(id) || lines.size >= MAX_LINES) continue
    const shape = feature.geometry
    const runs = shape?.type === 'LineString' ? [shape.coordinates] : shape?.type === 'MultiLineString' && Array.isArray(shape.coordinates) ? shape.coordinates : []
    const path = runs.map(run).filter((points) => points.length >= 2)
    if (path.length === 0) continue
    const kind = kindOf(row.route_type)
    const { number, name } = routeNames(row)
    lines.set(id, { id, kind, label: `${number && !name.toLowerCase().includes(number.toLowerCase()) ? `${number}: ` : ''}${name}\n${TRANSIT_LABELS[kind]}${text(row.agency_id) ? `, ${text(row.agency_id)}` : ''}`, path })
  }
  return [...lines.values()]
}

const MILES_PER_DEGREE = 69.05
/** A box around the point, so many miles each way. The service answers a box far faster than a circle where routes are dense. */
function box(latitude: number, longitude: number, miles: number): string {
  const up = miles / MILES_PER_DEGREE
  const across = up / Math.max(0.2, Math.cos((latitude * Math.PI) / 180))
  return [longitude - across, latitude - up, longitude + across, latitude + up].map((value) => value.toFixed(5)).join(',')
}

const ROUTE_FIELDS = 'ntd_id,route_id,agency_id,route_short_name,route_long_name,route_type'

/** The first four questions to ask the service about a point. */
export function transitUrls(latitude: number, longitude: number): { stops: string; stations: string; routes: string; railRoutes: string } {
  const shared = { inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outSR: '4326' }
  const at = { ...shared, geometry: `${longitude.toFixed(5)},${latitude.toFixed(5)}`, geometryType: 'esriGeometryPoint', units: 'esriSRUnit_Meter' }
  const within = (miles: number) => ({ ...shared, geometry: box(latitude, longitude, miles), geometryType: 'esriGeometryEnvelope' })
  const stopFields = 'ntd_id,stop_id,stop_name,location_type,stop_type,download_date'
  const railRoutes = `route_type IN (${RAIL_CODES.map((code) => `'${code}'`).join(',')})`
  return {
    stops: `${STOPS_URL}?${new URLSearchParams({ ...at, where: '1=1', distance: String(Math.round(WALK_MILES * METERS_PER_MILE)), outFields: stopFields, returnGeometry: 'true', f: 'json' })}`,
    // Everything that is not plainly a bus stop; stops whose kind the agency left blank are not counted as stations.
    stations: `${STOPS_URL}?${new URLSearchParams({ ...at, where: "stop_type NOT IN ('3','11','3;11','')", distance: String(Math.round(RAIL_MILES * METERS_PER_MILE)), outFields: stopFields, returnGeometry: 'true', f: 'json' })}`,
    routes: `${ROUTES_URL}?${new URLSearchParams({ ...within(WALK_MILES), where: '1=1', outFields: ROUTE_FIELDS, returnGeometry: 'false', f: 'json' })}`,
    railRoutes: `${ROUTES_URL}?${new URLSearchParams({ ...within(RAIL_MILES), where: railRoutes, outFields: `OBJECTID,Shape__Length,${ROUTE_FIELDS}`, returnGeometry: 'false', f: 'json' })}`,
  }
}

/** From the list of rail shapes nearby, the one to draw for each line: its longest. */
export function pickLineShapes(body: unknown): number[] {
  const best = new Map<string, { id: number; length: number }>()
  for (const feature of featuresOf(body)) {
    const row = feature.attributes ?? {}
    const id = Number(row.OBJECTID)
    if (!Number.isInteger(id)) continue
    const key = `${text(row.ntd_id)}-${text(row.route_id)}`
    const length = typeof row.Shape__Length === 'number' ? row.Shape__Length : 0
    const current = best.get(key)
    if (!current || length > current.length) best.set(key, { id, length })
  }
  return [...best.values()].slice(0, MAX_LINES).map((entry) => entry.id)
}

/** The fifth question: the shapes of the chosen rail lines, simplified to about five yards. */
export function lineShapesUrl(ids: number[]): string {
  return `${ROUTES_URL}?${new URLSearchParams({ objectIds: ids.join(','), outFields: ROUTE_FIELDS, returnGeometry: 'true', outSR: '4326', maxAllowableOffset: '0.00005', geometryPrecision: '5', f: 'geojson' })}`
}

/** Whether the service cut an answer short. */
const cutShort = (body: unknown) => {
  const answer = body as { exceededTransferLimit?: unknown; properties?: { exceededTransferLimit?: unknown } } | null
  return answer?.exceededTransferLimit === true || answer?.properties?.exceededTransferLimit === true
}

/** Puts the service's answers together. An answer that could not be had is passed as null and named in `missing`. */
export function buildTransitProfile(
  center: [number, number],
  answers: { stops: unknown; stations: unknown | null; routes: unknown | null; railRoutes?: unknown | null; lines: unknown | null },
): TransitProfile {
  const near = readStops(answers.stops, center).filter((stop) => stop.miles <= WALK_MILES + 0.02)
  const stations = answers.stations ? readStops(answers.stations, center).filter((stop) => stop.kind !== 'bus' && stop.kind !== 'other' && stop.miles <= RAIL_MILES + 0.05) : []
  const stops = uniqueStops([...near, ...stations]).map((stop) => ({ ...stop, miles: Number(stop.miles.toFixed(2)) }))
  const walkable = stops.filter((stop) => stop.miles <= WALK_MILES + 0.02)
  const dates = featuresOf(answers.stops).map((feature) => text(feature.attributes?.download_date)).filter(Boolean).sort()
  return {
    stops,
    nearestRail: stops.find((stop) => isRail(stop.kind)) ?? null,
    nearestBus: stops.find((stop) => stop.kind === 'bus') ?? null,
    walkCounts: Object.fromEntries(TRANSIT_KINDS.map((kind) => [kind, walkable.filter((stop) => stop.kind === kind).length])) as Record<TransitKind, number>,
    routes: answers.routes ? readRoutes(answers.routes) : [],
    lines: answers.lines ? readLines(answers.lines) : [],
    walkMiles: WALK_MILES,
    railMiles: RAIL_MILES,
    asOf: dates[dates.length - 1] ?? null,
    partial: cutShort(answers.routes) || cutShort(answers.railRoutes) || cutShort(answers.stops),
    missing: [answers.stations ? '' : 'rail stations further out', answers.routes ? '' : 'routes', answers.lines ? '' : 'rail lines'].filter(Boolean),
  }
}

/** One question to the service, kept for a month by Next. Null when it fails or the service reports an error inside its answer. */
async function ask(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), next: { revalidate: KEEP_SECONDS } } as RequestInit)
    if (!response.ok) return null
    const body = (await response.json()) as { error?: unknown } | null
    if (!body || body.error) {
      console.error('National Transit Map service refused a request', body?.error)
      return null
    }
    return body
  } catch (error) {
    console.error('Reading transit failed', error)
    return null
  }
}

/** The public transit around a point in the United States. */
export async function transitProfile(latitude: number, longitude: number): Promise<TransitResult> {
  const center: [number, number] = [Number(latitude.toFixed(5)), Number(longitude.toFixed(5))]
  const urls = transitUrls(center[0], center[1])
  const [stops, stations, routes, railRoutes] = await Promise.all([ask(urls.stops), ask(urls.stations), ask(urls.routes), ask(urls.railRoutes)])
  if (!stops) return { ok: false, error: 'The National Transit Map service could not be reached. Try again in a minute.' }
  const shapes = railRoutes ? pickLineShapes(railRoutes) : []
  // No rail lines nearby is an answer too, so it is passed as an empty list and not as "could not be loaded".
  const lines = !railRoutes ? null : shapes.length === 0 ? { features: [] } : await ask(lineShapesUrl(shapes))
  return { ok: true, profile: buildTransitProfile(center, { stops, stations, routes, railRoutes, lines }) }
}
