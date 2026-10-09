'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PropertyMap, type MapArea, type MapLine, type MapPin, type MapPoint } from '@/components/PropertyMap'
import type { AreaProfile, TractArea } from '@/lib/demographics'
import { SCHOOL_KINDS, SCHOOL_LABELS, SCHOOL_YEARS, type School, type SchoolKind, type SchoolProfile } from '@/lib/schools'
import { isRail, TRANSIT_KINDS, TRANSIT_LABELS, type TransitKind, type TransitProfile } from '@/lib/transit'
import { FLOOD_LABELS, FLOOD_MEANINGS, type FloodKind, type FloodProfile } from '@/lib/floodZones'

/** What the neighborhoods can be shaded by. Each reads one figure from a census tract and says how to write it. */
const MEASURES = [
  { key: 'medianIncome', label: 'Median Household Income', value: (tract: TractArea) => tract.medianIncome, format: (value: number) => `$${Math.round(value / 1000) * 1000 >= 1000 ? (Math.round(value / 1000) * 1000).toLocaleString('en-US') : Math.round(value).toLocaleString('en-US')}` },
  { key: 'density', label: 'Population Density', value: (tract: TractArea) => tract.density, format: (value: number) => `${(Math.round(value / 100) * 100).toLocaleString('en-US')} per sq mi` },
  { key: 'medianAge', label: 'Median Age', value: (tract: TractArea) => tract.medianAge, format: (value: number) => value.toFixed(1) },
  { key: 'renterShare', label: 'Homes That Are Rented', value: (tract: TractArea) => tract.renterShare, format: (value: number) => `${Math.round(value * 100)}%` },
  { key: 'bachelorsShare', label: "Adults with a Bachelor's Degree or More", value: (tract: TractArea) => tract.bachelorsShare, format: (value: number) => `${Math.round(value * 100)}%` },
] as const
type MeasureKey = (typeof MEASURES)[number]['key']

/** The shading used until the organization's graph colors have been read: one hue, light to dark. */
const SHADES = ['#c0daf9', '#86b6ef', '#3987e5', '#1c5cab', '#184076']

/**
 * Which of the five shades each kind of flood zone is drawn in, counting from the darkest of a single-color
 * palette (graph color 1) for the most serious. Land FEMA has not studied is a fixed grey.
 */
const FLOOD_SHADE: Partial<Record<FloodKind, number>> = { floodway: 4, coastal: 3, high: 2, moderate: 1, levee: 0 }
const NOT_STUDIED = '#8a8f98'

/** The dot colors for the six kinds of school until the organization's graph colors have been read. */
const DOTS = ['#184076', '#1c5cab', '#3987e5', '#86b6ef', '#c0daf9', '#5f9fe9']
/** How many transit routes and stations the lists show before "Show All". */
const TRANSIT_SHOWN = 8
/** How many schools the list shows before "Show All". */
const SCHOOLS_SHOWN = 10

/** "Public Elementary · PK to 5 · 1,119 students": what is known about a school, in one line. */
function schoolFacts(school: School): string {
  return [
    school.charter ? 'Public Charter' : SCHOOL_LABELS[school.kind],
    school.grades ? `Grades ${school.grades}` : '',
    school.students !== null ? `${school.students.toLocaleString('en-US')} students` : '',
    school.studentsPerTeacher !== null ? `${school.studentsPerTeacher} per teacher` : '',
  ].filter(Boolean).join(' · ')
}
const milesText = (miles: number) => `${miles < 0.1 ? 'Under 0.1' : miles.toFixed(1)} mi`

const whole = (value: number) => value.toLocaleString('en-US')
const percent = (value: number | null) => (value === null ? 'Not available' : `${Math.round(value * 100)}%`)

/**
 * Splits the values into up to five groups holding about the same number of
 * neighborhoods each, and returns the values where one group ends and the
 * next begins. Fewer distinct values give fewer groups.
 */
function groupLimits(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const limits: number[] = []
  for (let step = 1; step < SHADES.length; step += 1) {
    const limit = sorted[Math.min(sorted.length - 1, Math.floor((step * sorted.length) / SHADES.length))]
    if (limit > sorted[0] && limit !== limits[limits.length - 1]) limits.push(limit)
  }
  return limits
}

/** What can be laid over the map, one at a time. The first is the plain map. */
const LAYERS = [
  { key: 'none', label: 'None' },
  { key: 'demographics', label: 'Demographics' },
  { key: 'flood', label: 'Flood Zones' },
  { key: 'schools', label: 'Schools' },
  { key: 'transit', label: 'Transit' },
] as const
type Layer = (typeof LAYERS)[number]['key']
/** The distance circles that can be drawn around the address, whatever else is showing. */
const RING_MILES = [1, 3, 5] as const
/** How far out the census neighborhoods reach. */
const DEMOGRAPHIC_MILES = 5

/**
 * The Map tab's contents: the map with its pins, and a row of tabs choosing
 * what is laid over it around one of them, one thing at a time: nothing,
 * census demographics (neighborhoods shaded by a chosen figure and a table of
 * estimated totals within 1, 3 and 5 miles), FEMA's flood zones, schools, or
 * public transit.
 * The 1, 3 and 5 mile rings are a separate tick box and work with any of them.
 */
export function AssetMap({ pins }: { pins: MapPin[] }) {
  const [aroundId, setAroundId] = useState(pins[0]?.id ?? '')
  const [profiles, setProfiles] = useState<Record<string, AreaProfile>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [measure, setMeasure] = useState<MeasureKey | ''>('medianIncome')
  const [showRings, setShowRings] = useState(false)
  const [layer, setLayer] = useState<Layer>('none')
  const wanted = layer === 'demographics'
  const floodWanted = layer === 'flood'
  const schoolsWanted = layer === 'schools'
  const transitWanted = layer === 'transit'

  const [floods, setFloods] = useState<Record<string, FloodProfile>>({})
  const [floodLoading, setFloodLoading] = useState(false)
  const [floodError, setFloodError] = useState<string | null>(null)

  const [schoolSets, setSchoolSets] = useState<Record<string, SchoolProfile>>({})
  const [schoolsLoading, setSchoolsLoading] = useState(false)
  const [schoolsError, setSchoolsError] = useState<string | null>(null)
  const [hiddenKinds, setHiddenKinds] = useState<SchoolKind[]>([])
  const [allSchools, setAllSchools] = useState(false)

  const [transits, setTransits] = useState<Record<string, TransitProfile>>({})
  const [transitLoading, setTransitLoading] = useState(false)
  const [transitError, setTransitError] = useState<string | null>(null)
  const [hiddenTransit, setHiddenTransit] = useState<TransitKind[]>([])
  const [allRoutes, setAllRoutes] = useState(false)

  const around = pins.find((pin) => pin.id === aroundId) ?? pins[0]
  const profile = around ? profiles[around.id] : undefined
  const flood = around ? floods[around.id] : undefined
  const schools = around ? schoolSets[around.id] : undefined
  const transit = around ? transits[around.id] : undefined

  const loadTransit = async (pin: MapPin) => {
    setTransitError(null)
    if (transits[pin.id]) return
    setTransitLoading(true)
    try {
      const response = await fetch(`/api/transit?addressId=${pin.id}`)
      const result = (await response.json().catch(() => null)) as { ok?: boolean; profile?: TransitProfile; error?: string } | null
      if (result?.ok && result.profile) setTransits((current) => ({ ...current, [pin.id]: result.profile! }))
      else setTransitError(result?.error ?? 'The transit stops could not be loaded. Try again.')
    } catch {
      setTransitError('The transit stops could not be loaded. Check your connection and try again.')
    }
    setTransitLoading(false)
  }

  const loadSchools = async (pin: MapPin) => {
    setSchoolsError(null)
    if (schoolSets[pin.id]) return
    setSchoolsLoading(true)
    try {
      const response = await fetch(`/api/schools?addressId=${pin.id}`)
      const result = (await response.json().catch(() => null)) as { ok?: boolean; profile?: SchoolProfile; error?: string } | null
      if (result?.ok && result.profile) setSchoolSets((current) => ({ ...current, [pin.id]: result.profile! }))
      else setSchoolsError(result?.error ?? 'The schools could not be loaded. Try again.')
    } catch {
      setSchoolsError('The schools could not be loaded. Check your connection and try again.')
    }
    setSchoolsLoading(false)
  }

  const loadFlood = async (pin: MapPin) => {
    setFloodError(null)
    if (floods[pin.id]) return
    setFloodLoading(true)
    try {
      const response = await fetch(`/api/flood-zones?addressId=${pin.id}`)
      const result = (await response.json().catch(() => null)) as { ok?: boolean; profile?: FloodProfile; error?: string } | null
      if (result?.ok && result.profile) setFloods((current) => ({ ...current, [pin.id]: result.profile! }))
      else setFloodError(result?.error ?? 'The flood zones could not be loaded. Try again.')
    } catch {
      setFloodError('The flood zones could not be loaded. Check your connection and try again.')
    }
    setFloodLoading(false)
  }

  const load = async (pin: MapPin) => {
    setError(null)
    if (profiles[pin.id]) return
    setLoading(true)
    try {
      const response = await fetch(`/api/demographics?addressId=${pin.id}`)
      const result = (await response.json().catch(() => null)) as { ok?: boolean; profile?: AreaProfile; error?: string } | null
      if (result?.ok && result.profile) setProfiles((current) => ({ ...current, [pin.id]: result.profile! }))
      else setError(result?.error ?? 'The demographics could not be loaded. Try again.')
    } catch {
      setError('The demographics could not be loaded. Check your connection and try again.')
    }
    setLoading(false)
  }

  // The five groups are shaded with the organization's first five graph colors (Org Colors > Graph Colors),
  // the fifth for the lowest group up to the first for the highest. In a single-color palette such as Blues
  // those run light to dark, so darker still means more. The map needs real color values, so they are read
  // from the page once it is on screen.
  const frame = useRef<HTMLDivElement>(null)
  const [shades, setShades] = useState(SHADES)
  // Each kind of school has its own graph color, the first six in the order of the color key.
  const [dots, setDots] = useState(DOTS)
  const dotOf = (kind: SchoolKind) => dots[SCHOOL_KINDS.indexOf(kind)]
  useEffect(() => {
    if (!frame.current) return
    const style = getComputedStyle(frame.current)
    const found = [5, 4, 3, 2, 1].map((slot) => style.getPropertyValue(`--chart-${slot}`).trim())
    if (found.every((color) => /^#[0-9a-f]{6}$/i.test(color))) setShades(found)
    const six = [1, 2, 3, 4, 5, 6].map((slot) => style.getPropertyValue(`--chart-${slot}`).trim())
    if (six.every((color) => /^#[0-9a-f]{6}$/i.test(color))) setDots(six)
  }, [])

  const chosen = MEASURES.find((entry) => entry.key === measure)
  const { areas, legend } = useMemo(() => {
    if (!wanted || !profile || !chosen) return { areas: undefined as MapArea[] | undefined, legend: [] as { color: string; text: string }[] }
    const values = profile.tracts.map((tract) => chosen.value(tract)).filter((value): value is number => value !== null)
    const limits = groupLimits(values)
    // With fewer groups than shades, spread them across the light-to-dark range.
    const shadeOf = (group: number) => shades[limits.length === 0 ? 2 : Math.round((group * (shades.length - 1)) / limits.length)]
    const shaded: MapArea[] = profile.tracts.map((tract) => {
      const value = chosen.value(tract)
      return {
        id: tract.id,
        outline: tract.outline,
        color: value === null ? null : shadeOf(limits.filter((limit) => value >= limit).length),
        label: `${tract.name}\n${chosen.label}: ${value === null ? 'not available' : chosen.format(value)}${tract.population !== null ? `\nPopulation: ${whole(tract.population)}` : ''}`,
      }
    })
    const key = values.length === 0 ? [] : [...limits, Number.POSITIVE_INFINITY].map((limit, group) => ({
      color: shadeOf(group),
      text: group === 0 ? (limits.length === 0 ? 'All areas' : `Under ${chosen.format(limit)}`) : limit === Number.POSITIVE_INFINITY ? `${chosen.format(limits[group - 1])} or more` : `${chosen.format(limits[group - 1])} to ${chosen.format(limit)}`,
    }))
    return { areas: shaded, legend: key }
  }, [wanted, profile, chosen, shades])

  // Flood zones use the same five shades, the darkest end for the most serious.
  const floodColor = (kind: FloodKind) => (FLOOD_SHADE[kind] === undefined ? NOT_STUDIED : shades[FLOOD_SHADE[kind]!])
  const floodAreas = useMemo(() => {
    if (!floodWanted || !flood) return [] as MapArea[]
    return flood.areas.map((area): MapArea => {
      const color = FLOOD_SHADE[area.kind] === undefined ? NOT_STUDIED : shades[FLOOD_SHADE[area.kind]!]
      return {
        id: `flood-${area.id}`,
        outline: area.outline,
        color,
        edge: color,
        label: `Flood Zone ${area.zone}: ${FLOOD_LABELS[area.kind]}${area.detail && area.detail.toLowerCase() !== FLOOD_LABELS[area.kind].toLowerCase() ? `\n${area.detail}` : ''}${area.elevation ? `\nBase flood elevation: ${area.elevation}` : ''}`,
      }
    })
  }, [floodWanted, flood, shades])
  const drawn = useMemo(() => (areas || floodAreas.length > 0 ? [...(areas ?? []), ...floodAreas] : undefined), [areas, floodAreas])
  // Schools: the kinds ticked in the color key, as dots on the map and a list nearest first.
  const listed = useMemo(() => (schoolsWanted && schools ? schools.schools.filter((school) => !hiddenKinds.includes(school.kind)) : []), [schoolsWanted, schools, hiddenKinds])
  const schoolPoints = useMemo(
    () =>
      listed.map((school): MapPoint => ({
        id: school.id,
        position: [school.latitude, school.longitude],
        color: dots[SCHOOL_KINDS.indexOf(school.kind)],
        label: `${school.name}\n${schoolFacts(school)}\n${milesText(school.miles)} away`,
      })),
    [listed, dots],
  )
  // Transit: stops as dots and rail lines as lines, in the kinds ticked in the color key. Each kind has its
  // own graph color, the first six in the order of the color key.
  const transitColor = (kind: TransitKind) => dots[TRANSIT_KINDS.indexOf(kind)]
  const transitPoints = useMemo(
    () =>
      (transitWanted && transit ? transit.stops : [])
        .filter((stop) => !hiddenTransit.includes(stop.kind))
        .map((stop): MapPoint => ({
          id: stop.id,
          position: [stop.latitude, stop.longitude],
          color: dots[TRANSIT_KINDS.indexOf(stop.kind)],
          label: `${stop.name}\n${TRANSIT_LABELS[stop.kind]}${isRail(stop.kind) ? ' station' : ' stop'}\n${milesText(stop.miles)} away`,
        })),
    [transitWanted, transit, hiddenTransit, dots],
  )
  const lines = useMemo(
    () =>
      (transitWanted && transit ? transit.lines : [])
        .filter((line) => !hiddenTransit.includes(line.kind))
        .map((line): MapLine => ({ id: line.id, path: line.path, color: dots[TRANSIT_KINDS.indexOf(line.kind)], label: line.label })),
    [transitWanted, transit, hiddenTransit, dots],
  )
  const points = schoolsWanted ? schoolPoints : transitPoints
  const stations = transit ? transit.stops.filter((stop) => isRail(stop.kind) || stop.kind === 'ferry') : []
  // The transit view is walking distance, widened to bring the nearest rail station into view.
  const transitReach = transit ? Math.min(transit.railMiles, Math.max(transit.walkMiles, (transit.nearestRail?.miles ?? 0) + 0.25)) : 0
  // The map takes in what is being shown around the address.
  const reachMiles = wanted && profile ? DEMOGRAPHIC_MILES : floodWanted && flood ? flood.miles : schoolsWanted && schools ? schools.miles : transitWanted && transit ? transitReach : 0
  const reach = reachMiles > 0 && around ? { center: [around.latitude, around.longitude] as [number, number], miles: reachMiles } : null

  const rings = showRings && around ? { center: [around.latitude, around.longitude] as [number, number], miles: RING_MILES } : null

  // Choosing a tab shows that layer for the address in "Around", fetching it the first time.
  const show = (next: Layer, pin: MapPin | undefined = around) => {
    setLayer(next)
    if (!pin) return
    if (next === 'demographics') void load(pin)
    if (next === 'flood') void loadFlood(pin)
    if (next === 'schools') void loadSchools(pin)
    if (next === 'transit') void loadTransit(pin)
  }

  return (
    <div ref={frame}>
      <div className="map-bar">
        <div className="map-tabs" role="tablist" aria-label="Shown on the map">
          {LAYERS.map((entry) => (
            <button key={entry.key} type="button" role="tab" aria-selected={entry.key === layer} className={`map-tab${entry.key === layer ? ' active' : ''}`} onClick={() => show(entry.key)}>
              {entry.label}
            </button>
          ))}
        </div>
        <label className="map-check">
          <input type="checkbox" checked={showRings} onChange={(event) => setShowRings(event.target.checked)} />
          Show 1, 3 and 5 Mile Rings
        </label>
        {pins.length > 1 ? (
          <label className="map-around">
            Around
            <select
              value={around?.id ?? ''}
              onChange={(event) => {
                setAroundId(event.target.value)
                show(layer, pins.find((pin) => pin.id === event.target.value))
              }}
            >
              {pins.map((pin) => (
                <option key={pin.id} value={pin.id}>{pin.title}: {pin.address}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="map-layout">
      <div className="map-main">
        <PropertyMap pins={pins} areas={drawn} rings={rings} reach={reach} points={points} lines={lines} />
      </div>

      {layer !== 'none' ? (
      <aside className="map-side" aria-label={LAYERS.find((entry) => entry.key === layer)?.label}>
        {wanted && loading ? <p className="note" role="status">Getting census figures. The first time for an address can take a few seconds…</p> : null}
        {wanted && error ? (
          <>
            <p className="form-error" role="alert">{error}</p>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => around && void load(around)}>Try Again</button>
          </>
        ) : null}

        {wanted && profile ? (
          <>
            <div className="field">
              <label htmlFor="map-measure">Shade Neighborhoods By</label>
              <select id="map-measure" value={measure} onChange={(event) => setMeasure(event.target.value as MeasureKey | '')}>
                <option value="">Nothing</option>
                {MEASURES.map((entry) => (
                  <option key={entry.key} value={entry.key}>{entry.label}</option>
                ))}
              </select>
            </div>
            {chosen && legend.length > 0 ? (
              <ul className="map-legend" aria-label={`Colors for ${chosen.label}`}>
                {legend.map((entry) => (
                  <li key={entry.text}><span className="map-swatch" style={{ background: entry.color }} aria-hidden="true" />{entry.text}</li>
                ))}
                <li><span className="map-swatch map-swatch-empty" aria-hidden="true" />No figure</li>
              </ul>
            ) : null}
            {chosen && legend.length === 0 ? <p className="note">The Census has no {chosen.label.toLowerCase()} figures for these neighborhoods.</p> : null}

            <div className="table-scroll">
              <table className="map-rings">
                <caption>Estimated Within Each Distance</caption>
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">Figure</span></th>
                    {profile.rings.map((ring) => (
                      <th key={ring.miles} scope="col">{ring.miles} {ring.miles === 1 ? 'Mile' : 'Miles'}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr><th scope="row">Population</th>{profile.rings.map((ring) => <td key={ring.miles}>{whole(ring.population)}</td>)}</tr>
                  <tr><th scope="row">Households</th>{profile.rings.map((ring) => <td key={ring.miles}>{whole(ring.households)}</td>)}</tr>
                  <tr><th scope="row">Average Household Income</th>{profile.rings.map((ring) => <td key={ring.miles}>{ring.averageIncome === null ? 'Not available' : `$${whole(ring.averageIncome)}`}</td>)}</tr>
                  <tr><th scope="row">Homes That Are Rented</th>{profile.rings.map((ring) => <td key={ring.miles}>{percent(ring.renterShare)}</td>)}</tr>
                  <tr><th scope="row">Bachelor&apos;s Degree or More</th>{profile.rings.map((ring) => <td key={ring.miles}>{percent(ring.bachelorsShare)}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <p className="doc-sub">
              Source: U.S. Census Bureau, American Community Survey, {profile.survey}. Each shaded area is a census tract. Figures within each distance are
              estimates: a tract a ring cuts through counts by the share of its land inside the ring.
            </p>
          </>
        ) : null}

        {floodWanted && floodLoading ? <p className="note" role="status">Getting FEMA&apos;s flood map. This can take a few seconds…</p> : null}
        {floodWanted && floodError ? (
          <>
            <p className="form-error" role="alert">{floodError}</p>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => around && void loadFlood(around)}>Try Again</button>
          </>
        ) : null}
        {floodWanted && flood ? (
          <>
            {flood.at ? (
              <div className="flood-at">
                <span className="flood-at-label">This Address</span>
                <strong>Zone {flood.at.zone}: {FLOOD_LABELS[flood.at.kind]}</strong>
                <p>{FLOOD_MEANINGS[flood.at.kind]}</p>
                <dl>
                  <div><dt>Special Flood Hazard Area</dt><dd>{flood.at.special ? 'Yes' : 'No'}</dd></div>
                  {flood.at.detail ? <div><dt>FEMA&apos;s Description</dt><dd>{flood.at.detail}</dd></div> : null}
                  {flood.at.elevation ? <div><dt>Base Flood Elevation</dt><dd>{flood.at.elevation}</dd></div> : null}
                </dl>
              </div>
            ) : (
              <p className="note">FEMA has no flood map data for this spot. Not every county&apos;s flood maps are available as map data.</p>
            )}
            {flood.kinds.length > 0 ? (
              <ul className="map-legend" aria-label="Colors for flood zones">
                {flood.kinds.map((kind) => (
                  <li key={kind} title={FLOOD_MEANINGS[kind]}><span className="map-swatch" style={{ background: floodColor(kind) }} aria-hidden="true" />{FLOOD_LABELS[kind]}</li>
                ))}
                <li title={FLOOD_MEANINGS.minimal}><span className="map-swatch map-swatch-empty" aria-hidden="true" />{FLOOD_LABELS.minimal}</li>
              </ul>
            ) : flood.at ? (
              <p className="note">There are no higher-risk zones within about a mile.</p>
            ) : null}
            {flood.partial ? <p className="note">There are more zones here than FEMA sends at once, so some outlines may be missing.</p> : null}
            <p className="doc-sub">
              Source: FEMA National Flood Hazard Layer, the flood insurance maps now in effect. The pin sits along the street rather than on
              the building, so near the edge of a zone check the building itself on{' '}
              <a href="https://msc.fema.gov/portal/home" target="_blank" rel="noreferrer">FEMA&apos;s Flood Map Service Center</a>. This is not an official flood determination.
            </p>
          </>
        ) : null}

        {schoolsWanted && schoolsLoading ? <p className="note" role="status">Getting the schools. This can take a few seconds…</p> : null}
        {schoolsWanted && schoolsError ? (
          <>
            <p className="form-error" role="alert">{schoolsError}</p>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => around && void loadSchools(around)}>Try Again</button>
          </>
        ) : null}
        {schoolsWanted && schools ? (
          <>
            {schools.district ? (
              <div className="flood-at">
                <span className="flood-at-label">School District</span>
                <strong>{schools.district.name}</strong>
                <dl>
                  {schools.district.grades ? <div><dt>Grades</dt><dd>{schools.district.grades}</dd></div> : null}
                  {schools.district.schools !== null ? <div><dt>Schools</dt><dd>{whole(schools.district.schools)}</dd></div> : null}
                  {schools.district.students !== null ? <div><dt>Students</dt><dd>{whole(schools.district.students)}</dd></div> : null}
                  {schools.district.studentsPerTeacher !== null ? <div><dt>Students per Teacher</dt><dd>{schools.district.studentsPerTeacher}</dd></div> : null}
                </dl>
              </div>
            ) : schools.missing.includes('the school district') ? null : (
              <p className="note">No school district was found for this spot.</p>
            )}
            {schools.schools.length > 0 ? (
              <ul className="map-legend" aria-label="Kinds of school to show">
                {SCHOOL_KINDS.filter((kind) => schools.counts[kind] > 0).map((kind) => (
                  <li key={kind}>
                    <label className="map-check">
                      <input
                        type="checkbox"
                        checked={!hiddenKinds.includes(kind)}
                        onChange={(event) => setHiddenKinds((current) => (event.target.checked ? current.filter((entry) => entry !== kind) : [...current, kind]))}
                      />
                      <span className="map-dot" style={{ background: dotOf(kind) }} aria-hidden="true" />
                      {SCHOOL_LABELS[kind]} ({schools.counts[kind]})
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="note">No schools were found within {schools.miles} miles.</p>
            )}
            {listed.length > 0 ? (
              <ol className="school-list" aria-label={`Schools within ${schools.miles} miles, nearest first`}>
                {(allSchools ? listed : listed.slice(0, SCHOOLS_SHOWN)).map((school) => (
                  <li key={school.id}>
                    <span className="map-dot" style={{ background: dotOf(school.kind) }} aria-hidden="true" />
                    <div>
                      <strong>{school.name}</strong>
                      <span>{schoolFacts(school)}</span>
                      {school.operator && !school.charter ? <span>{school.operator}{school.inDistrict ? '' : ' (a different district from this address)'}</span> : null}
                    </div>
                    <span className="school-miles">{milesText(school.miles)}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            {listed.length > SCHOOLS_SHOWN ? (
              <button type="button" className="link-button" onClick={() => setAllSchools((current) => !current)}>{allSchools ? 'Show Fewer' : `Show All ${listed.length}`}</button>
            ) : null}
            {schools.missing.length > 0 ? <p className="note">Could not be loaded this time: {schools.missing.join(', ')}.</p> : null}
            <p className="doc-sub">
              Source: National Center for Education Statistics (public schools {SCHOOL_YEARS.public}, private schools {SCHOOL_YEARS.private},
              colleges {SCHOOL_YEARS.college}). Distances are straight lines. The nearest school is not always the assigned one: each
              district draws its own attendance zones, which are not in this data. There are no ratings or test scores here.
            </p>
          </>
        ) : null}

        {transitWanted && transitLoading ? <p className="note" role="status">Getting the transit stops. This can take a few seconds…</p> : null}
        {transitWanted && transitError ? (
          <>
            <p className="form-error" role="alert">{transitError}</p>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => around && void loadTransit(around)}>Try Again</button>
          </>
        ) : null}
        {transitWanted && transit ? (
          <>
            <div className="flood-at">
              <span className="flood-at-label">Transit Nearby</span>
              <strong>
                {transit.nearestRail
                  ? `${transit.nearestRail.name}, ${milesText(transit.nearestRail.miles)}`
                  : transit.nearestBus
                    ? `Bus stop ${milesText(transit.nearestBus.miles)} away`
                    : 'No transit stops found nearby'}
              </strong>
              <dl>
                <div><dt>Nearest Rail Station</dt><dd>{transit.nearestRail ? `${TRANSIT_LABELS[transit.nearestRail.kind]}, ${milesText(transit.nearestRail.miles)}` : `None within ${transit.railMiles} miles`}</dd></div>
                <div><dt>Nearest Bus Stop</dt><dd>{transit.nearestBus ? milesText(transit.nearestBus.miles) : 'None within half a mile'}</dd></div>
                <div><dt>Stops Within Half a Mile</dt><dd>{whole(TRANSIT_KINDS.reduce((sum, kind) => sum + transit.walkCounts[kind], 0))}</dd></div>
                <div><dt>Routes Nearby</dt><dd>{whole(transit.routes.length)}</dd></div>
              </dl>
            </div>
            {transit.stops.length > 0 ? (
              <ul className="map-legend" aria-label="Kinds of transit to show">
                {TRANSIT_KINDS.filter((kind) => transit.stops.some((stop) => stop.kind === kind)).map((kind) => (
                  <li key={kind}>
                    <label className="map-check">
                      <input
                        type="checkbox"
                        checked={!hiddenTransit.includes(kind)}
                        onChange={(event) => setHiddenTransit((current) => (event.target.checked ? current.filter((entry) => entry !== kind) : [...current, kind]))}
                      />
                      <span className="map-dot" style={{ background: transitColor(kind) }} aria-hidden="true" />
                      {TRANSIT_LABELS[kind]} ({transit.stops.filter((stop) => stop.kind === kind).length})
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {stations.length > 0 ? (
              <>
                <h4 className="map-side-title">Stations Within {transit.railMiles} Miles</h4>
                <ol className="school-list">
                  {stations.slice(0, TRANSIT_SHOWN).map((stop) => (
                    <li key={stop.id}>
                      <span className="map-dot" style={{ background: transitColor(stop.kind) }} aria-hidden="true" />
                      <div><strong>{stop.name}</strong><span>{TRANSIT_LABELS[stop.kind]}</span></div>
                      <span className="school-miles">{milesText(stop.miles)}</span>
                    </li>
                  ))}
                </ol>
                {stations.length > TRANSIT_SHOWN ? <p className="note">And {stations.length - TRANSIT_SHOWN} more further out, shown on the map.</p> : null}
              </>
            ) : null}
            {transit.routes.length > 0 ? (
              <>
                <h4 className="map-side-title">Routes Nearby</h4>
                <ol className="school-list">
                  {(allRoutes ? transit.routes : transit.routes.slice(0, TRANSIT_SHOWN)).map((route) => (
                    <li key={route.id}>
                      <span className="map-dot" style={{ background: transitColor(route.kind) }} aria-hidden="true" />
                      <div>
                        <strong>{route.number && !route.name.toLowerCase().includes(route.number.toLowerCase()) ? `${route.number}: ` : ''}{route.name}</strong>
                        <span>{TRANSIT_LABELS[route.kind]}{route.agency ? ` · ${route.agency}` : ''}</span>
                      </div>
                    </li>
                  ))}
                </ol>
                {transit.routes.length > TRANSIT_SHOWN ? (
                  <button type="button" className="link-button" onClick={() => setAllRoutes((current) => !current)}>{allRoutes ? 'Show Fewer' : `Show All ${transit.routes.length}`}</button>
                ) : null}
              </>
            ) : null}
            {transit.partial ? <p className="note">There is more transit here than the service sends at once, so some routes or lines are left out.</p> : null}
            {transit.missing.length > 0 ? <p className="note">Could not be loaded this time: {transit.missing.join(', ')}.</p> : null}
            <p className="doc-sub">
              Source: National Transit Map, U.S. Department of Transportation{transit.asOf ? ` (agency schedules gathered ${transit.asOf})` : ''}. Every
              stop within half a mile is shown, rail stations and lines out to {transit.railMiles} miles, and the routes that pass within
              about half a mile. Distances are straight lines.
              Agencies take part by choice, so a small system may be missing; Amtrak and intercity buses are not included; and this shows
              where service runs, not how often.
            </p>
          </>
        ) : null}
      </aside>
      ) : null}
      </div>
    </div>
  )
}
