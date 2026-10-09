// Who lives around a point: U.S. Census figures for the neighborhoods (census
// tracts) within five miles, and estimated totals inside 1, 3 and 5 mile rings.
//
// Two free Census Bureau services are used, both from the server:
// - TIGERweb gives the tracts near the point and their outlines (no key);
// - the Data API gives each tract's American Community Survey figures. It
//   requires a free key in CENSUS_API_KEY.
//
// Ring totals are estimates: a tract that a ring cuts through contributes the
// share of its land that falls inside the ring, as if its people were spread
// evenly. That is the usual method, and it is why the 1 mile figures are
// rougher than the 5 mile ones.

export const RING_MILES = [1, 3, 5] as const
const METERS_PER_MILE = 1609.344
const TRACTS_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query'
const DATA_URL = 'https://api.census.gov/data'
/** The survey to ask for first, then the one before it if that isn't published yet. Each covers five years ending in its year. */
const SURVEY_YEARS = [2024, 2023]
/** Census figures change once a year, so answers are kept for a month. */
const KEEP_SECONDS = 60 * 60 * 24 * 30
const MAX_TRACTS = 600

const VARIABLES = {
  population: 'B01003_001E',
  households: 'B11001_001E',
  medianIncome: 'B19013_001E',
  totalIncome: 'B19025_001E',
  medianAge: 'B01002_001E',
  occupiedHomes: 'B25003_001E',
  rentedHomes: 'B25003_003E',
  adults25: 'B15003_001E',
  bachelors: 'B15003_022E',
  masters: 'B15003_023E',
  professional: 'B15003_024E',
  doctorate: 'B15003_025E',
} as const
type VariableName = keyof typeof VARIABLES

/** One neighborhood on the map. `outline` is its shape as rings of [latitude, longitude]. */
export type TractArea = {
  id: string
  name: string
  outline: [number, number][][]
  population: number | null
  /** People per square mile of land. */
  density: number | null
  medianIncome: number | null
  medianAge: number | null
  /** 0 to 1: homes that are rented rather than owned. */
  renterShare: number | null
  /** 0 to 1: adults 25 and over with a bachelor's degree or more. */
  bachelorsShare: number | null
}
export type RingTotals = {
  miles: number
  population: number
  households: number
  averageIncome: number | null
  renterShare: number | null
  bachelorsShare: number | null
}
export type AreaProfile = { survey: string; tracts: TractArea[]; rings: RingTotals[] }
export type ProfileResult = { ok: true; profile: AreaProfile } | { ok: false; error: string }

export const censusKey = (): string | null => process.env.CENSUS_API_KEY?.trim() || null

type RawTract = { id: string; state: string; county: string; tract: string; name: string; landSquareMeters: number; outline: [number, number][][] }

/** Reads TIGERweb's answer: each tract's ids, land area and outline. The service gives points as [longitude, latitude]. */
export function readTracts(body: unknown): RawTract[] {
  const features = (body as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) return []
  const tracts: RawTract[] = []
  for (const feature of features as { attributes?: Record<string, unknown>; geometry?: { rings?: unknown } }[]) {
    const fields = feature?.attributes ?? {}
    const state = String(fields.STATE ?? '')
    const county = String(fields.COUNTY ?? '')
    const tract = String(fields.TRACT ?? '')
    if (!/^\d{2}$/.test(state) || !/^\d{3}$/.test(county) || !/^\d{6}$/.test(tract)) continue
    const rings = Array.isArray(feature.geometry?.rings) ? (feature.geometry!.rings as unknown[]) : []
    const outline: [number, number][][] = []
    for (const ring of rings) {
      if (!Array.isArray(ring)) continue
      const points: [number, number][] = []
      for (const point of ring as unknown[]) {
        const longitude = Number((point as unknown[])?.[0])
        const latitude = Number((point as unknown[])?.[1])
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) points.push([Number(latitude.toFixed(5)), Number(longitude.toFixed(5))])
      }
      if (points.length >= 3) outline.push(points)
    }
    if (outline.length === 0) continue
    tracts.push({ id: `${state}${county}${tract}`, state, county, tract, name: String(fields.NAME ?? `Census Tract ${fields.BASENAME ?? tract}`), landSquareMeters: Number(fields.AREALAND) || 0, outline })
    if (tracts.length >= MAX_TRACTS) break
  }
  return tracts
}

/**
 * Reads one Data API answer (a header row, then one row per tract) into
 * figures by tract id. The Census marks a missing figure with a large
 * negative number, which becomes null here.
 */
export function readFigures(body: unknown): Map<string, Record<VariableName, number | null>> {
  const figures = new Map<string, Record<VariableName, number | null>>()
  if (!Array.isArray(body) || !Array.isArray(body[0])) return figures
  const header = (body[0] as unknown[]).map(String)
  const column = (label: string) => header.indexOf(label)
  const [state, county, tract] = [column('state'), column('county'), column('tract')]
  if (state < 0 || county < 0 || tract < 0) return figures
  const names = Object.keys(VARIABLES) as VariableName[]
  for (const row of (body as unknown[][]).slice(1)) {
    const values = {} as Record<VariableName, number | null>
    for (const name of names) {
      const raw = row[column(VARIABLES[name])]
      const value = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw)
      values[name] = Number.isFinite(value) && value >= 0 ? value : null
    }
    figures.set(`${row[state]}${row[county]}${row[tract]}`, values)
  }
  return figures
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

/** Miles between two points. Accurate to well under a percent at these distances. */
export function milesBetween(a: [number, number], b: [number, number]): number {
  const dLat = toRadians(b[0] - a[0])
  const dLon = toRadians(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a[0])) * Math.cos(toRadians(b[0])) * Math.sin(dLon / 2) ** 2
  return 3958.7613 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Whether a point is inside an outline. Counting crossings over every ring handles holes and separate pieces alike. */
function inside(point: [number, number], outline: [number, number][][]): boolean {
  let within = false
  for (const ring of outline) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [latI, lonI] = ring[i]
      const [latJ, lonJ] = ring[j]
      if (latI > point[0] !== latJ > point[0] && point[1] < ((lonJ - lonI) * (point[0] - latI)) / (latJ - latI) + lonI) within = !within
    }
  }
  return within
}

const GRID = 28

/**
 * For each ring, the share (0 to 1) of an outline's area that lies within
 * that many miles of the center. Worked out by laying a grid of sample points
 * over the outline and counting.
 */
export function sharesWithin(center: [number, number], outline: [number, number][][], miles: readonly number[]): number[] {
  let south = 90, north = -90, west = 180, east = -180
  for (const ring of outline) {
    for (const [latitude, longitude] of ring) {
      south = Math.min(south, latitude); north = Math.max(north, latitude)
      west = Math.min(west, longitude); east = Math.max(east, longitude)
    }
  }
  // Shortcuts: every corner of the outline's box inside a ring means all of it is; a box wholly beyond a ring means none is.
  const corners: [number, number][] = [[south, west], [south, east], [north, west], [north, east]]
  const farthest = Math.max(...corners.map((corner) => milesBetween(center, corner)))
  const nearest = milesBetween(center, [Math.min(Math.max(center[0], south), north), Math.min(Math.max(center[1], west), east)])
  let sampled = 0
  const counts = miles.map(() => 0)
  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < GRID; col += 1) {
      const point: [number, number] = [south + ((row + 0.5) / GRID) * (north - south), west + ((col + 0.5) / GRID) * (east - west)]
      if (!inside(point, outline)) continue
      sampled += 1
      const distance = milesBetween(center, point)
      miles.forEach((limit, index) => {
        if (distance <= limit) counts[index] += 1
      })
    }
  }
  return miles.map((limit, index) => {
    if (farthest <= limit) return 1
    if (nearest > limit) return 0
    // An outline too thin for the grid to land on is judged by its box's middle.
    if (sampled === 0) return milesBetween(center, [(south + north) / 2, (west + east) / 2]) <= limit ? 1 : 0
    return counts[index] / sampled
  })
}

const share = (part: number | null, whole: number | null) => (part !== null && whole !== null && whole > 0 ? part / whole : null)

/** Puts outlines and figures together: each tract's own numbers, and the estimated totals inside each ring. */
export function buildProfile(center: [number, number], tracts: RawTract[], figures: Map<string, Record<VariableName, number | null>>, survey: string): AreaProfile {
  const sums = RING_MILES.map(() => ({ population: 0, households: 0, income: 0, incomeHouseholds: 0, rented: 0, occupied: 0, degrees: 0, adults: 0 }))
  const areas: TractArea[] = []
  for (const tract of tracts) {
    const values = figures.get(tract.id)
    const degrees = values && values.bachelors !== null ? values.bachelors + (values.masters ?? 0) + (values.professional ?? 0) + (values.doctorate ?? 0) : null
    const squareMiles = tract.landSquareMeters / (METERS_PER_MILE * METERS_PER_MILE)
    areas.push({
      id: tract.id,
      name: tract.name,
      outline: tract.outline,
      population: values?.population ?? null,
      density: values && values.population !== null && squareMiles > 0.005 ? values.population / squareMiles : null,
      medianIncome: values?.medianIncome ?? null,
      medianAge: values?.medianAge ?? null,
      renterShare: share(values?.rentedHomes ?? null, values?.occupiedHomes ?? null),
      bachelorsShare: share(degrees, values?.adults25 ?? null),
    })
    if (!values) continue
    sharesWithin(center, tract.outline, RING_MILES).forEach((part, index) => {
      if (part === 0) return
      const sum = sums[index]
      sum.population += part * (values.population ?? 0)
      sum.households += part * (values.households ?? 0)
      // Average income needs both halves from the same tracts, so a tract with no income figure is left out of both.
      if (values.totalIncome !== null && values.households !== null) {
        sum.income += part * values.totalIncome
        sum.incomeHouseholds += part * values.households
      }
      if (values.rentedHomes !== null && values.occupiedHomes !== null) {
        sum.rented += part * values.rentedHomes
        sum.occupied += part * values.occupiedHomes
      }
      if (degrees !== null && values.adults25 !== null) {
        sum.degrees += part * degrees
        sum.adults += part * values.adults25
      }
    })
  }
  return {
    survey,
    tracts: areas,
    rings: RING_MILES.map((miles, index) => ({
      miles,
      population: Math.round(sums[index].population),
      households: Math.round(sums[index].households),
      averageIncome: sums[index].incomeHouseholds > 0 ? Math.round(sums[index].income / sums[index].incomeHouseholds) : null,
      renterShare: sums[index].occupied > 0 ? sums[index].rented / sums[index].occupied : null,
      bachelorsShare: sums[index].adults > 0 ? sums[index].degrees / sums[index].adults : null,
    })),
  }
}

/** A fetch whose answer Next keeps for a month. The options are Next's own addition to fetch. */
const kept = (url: string, timeoutMs: number) => fetch(url, { signal: AbortSignal.timeout(timeoutMs), next: { revalidate: KEEP_SECONDS } } as RequestInit)

/** The census picture around a point in the United States. */
export async function areaProfile(latitude: number, longitude: number): Promise<ProfileResult> {
  const key = censusKey()
  if (!key) return { ok: false, error: 'Demographics are not set up yet: a free Census Bureau key (CENSUS_API_KEY) has to be added.' }
  const center: [number, number] = [Number(latitude.toFixed(5)), Number(longitude.toFixed(5))]

  let tracts: RawTract[]
  try {
    const query = new URLSearchParams({
      geometry: `${center[1]},${center[0]}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      // A little past five miles, so tracts the outer ring only touches are included.
      distance: String(Math.round((RING_MILES[RING_MILES.length - 1] + 0.1) * METERS_PER_MILE)),
      units: 'esriSRUnit_Meter',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'STATE,COUNTY,TRACT,BASENAME,NAME,AREALAND',
      returnGeometry: 'true',
      outSR: '4326',
      // Outlines simplified to about 30 yards: plenty for a map, and far smaller to send.
      maxAllowableOffset: '0.0003',
      geometryPrecision: '5',
      f: 'json',
    })
    const response = await kept(`${TRACTS_URL}?${query}`, 25000)
    if (!response.ok) return { ok: false, error: 'The Census map service is not answering right now. Try again in a minute.' }
    tracts = readTracts(await response.json())
  } catch (error) {
    console.error('Reading census tracts failed', error)
    return { ok: false, error: 'The Census map service could not be reached. Try again in a minute.' }
  }
  if (tracts.length === 0) return { ok: false, error: 'No census areas were found here. Demographics cover the United States only.' }

  const counties = [...new Set(tracts.map((tract) => `${tract.state}:${tract.county}`))]
  const variables = Object.values(VARIABLES).join(',')
  let refused = ''
  for (const year of SURVEY_YEARS) {
    try {
      const figures = new Map<string, Record<VariableName, number | null>>()
      let complete = true
      for (const entry of counties) {
        const [state, county] = entry.split(':')
        const response = await kept(`${DATA_URL}/${year}/acs/acs5?get=${variables}&for=tract:*&in=state:${state}%20county:${county}&key=${encodeURIComponent(key)}`, 20000)
        const text = await response.text()
        let body: unknown = null
        try {
          body = JSON.parse(text)
        } catch {
          // The service answers a bad key or an unpublished year with a web page instead of data.
          refused = /key/i.test(text) ? 'The Census Bureau did not accept the key. Check CENSUS_API_KEY, and that the key was activated from the email.' : refused
        }
        if (!response.ok || !Array.isArray(body)) {
          complete = false
          break
        }
        for (const [id, values] of readFigures(body)) figures.set(id, values)
      }
      if (complete && figures.size > 0) return { ok: true, profile: buildProfile(center, tracts, figures, `${year - 4} to ${year}`) }
    } catch (error) {
      // Never log the address asked for: it carries the key.
      console.error(`Reading ${year} census figures failed`, error instanceof Error ? error.name : 'error')
    }
  }
  return { ok: false, error: refused || 'The Census data service is not answering right now. Try again in a minute.' }
}
