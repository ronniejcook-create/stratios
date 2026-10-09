'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PropertyMap, type MapArea, type MapLine, type MapPin, type MapPoint } from '@/components/PropertyMap'
import type { AreaProfile, TractArea } from '@/lib/demographics'
import { SCHOOL_KINDS, SCHOOL_LABELS, SCHOOL_YEARS, type School, type SchoolKind, type SchoolProfile } from '@/lib/schools'
import { isRail, TRANSIT_KINDS, TRANSIT_LABELS, type TransitKind, type TransitProfile } from '@/lib/transit'
import { HAZARD_CHOICES, HAZARD_RATINGS, hazardLabel, type HazardChoice, type HazardProfile } from '@/lib/hazards'
import { JOB_SECTORS, type JobsProfile } from '@/lib/jobs'
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
  { key: 'schools', label: 'Schools' },
  { key: 'jobs', label: 'Jobs and Commuting' },
  { key: 'transit', label: 'Transit' },
  { key: 'flood', label: 'Flood Zones' },
  { key: 'hazards', label: 'Natural Hazards' },
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
 * estimated totals within 1, 3 and 5 miles), FEMA's flood zones, schools,
 * jobs and commuting, public transit, or FEMA's natural hazard ratings.
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
  const hazardsWanted = layer === 'hazards'
  const jobsWanted = layer === 'jobs'

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

  const [hazardSets, setHazardSets] = useState<Record<string, HazardProfile>>({})
  const [hazardsLoading, setHazardsLoading] = useState(false)
  const [hazardsError, setHazardsError] = useState<string | null>(null)
  const [hazardChoice, setHazardChoice] = useState<HazardChoice>('ALL')

  const [jobSets, setJobSets] = useState<Record<string, JobsProfile>>({})
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsError, setJobsError] = useState<string | null>(null)

  const around = pins.find((pin) => pin.id === aroundId) ?? pins[0]
  const profile = around ? profiles[around.id] : undefined
  const flood = around ? floods[around.id] : undefined
  const schools = around ? schoolSets[around.id] : undefined
  const transit = around ? transits[around.id] : undefined
  const hazards = around ? hazardSets[around.id] : undefined
  const jobs = around ? jobSets[around.id] : undefined

  const loadJobs = async (pin: MapPin) => {
    setJobsError(null)
    if (jobSets[pin.id]) return
    setJobsLoading(true)
    try {
      const response = await fetch(`/api/jobs?addressId=${pin.id}`)
      const result = (await response.json().catch(() => null)) as { ok?: boolean; profile?: JobsProfile; error?: string } | null
      if (result?.ok && result.profile) setJobSets((current) => ({ ...current, [pin.id]: result.profile! }))
      else setJobsError(result?.error ?? 'The jobs figures could not be loaded. Try again.')
    } catch {
      setJobsError('The jobs figures could not be loaded. Check your connection and try again.')
    }
    setJobsLoading(false)
  }

  const loadHazards = async (pin: MapPin) => {
    setHazardsError(null)
    if (hazardSets[pin.id]) return
    setHazardsLoading(true)
    try {
      const response = await fetch(`/api/hazards?addressId=${pin.id}`)
      const result = (await response.json().catch(() => null)) as { ok?: boolean; profile?: HazardProfile; error?: string } | null
      if (result?.ok && result.profile) setHazardSets((current) => ({ ...current, [pin.id]: result.profile! }))
      else setHazardsError(result?.error ?? 'The natural hazard ratings could not be loaded. Try again.')
    } catch {
      setHazardsError('The natural hazard ratings could not be loaded. Check your connection and try again.')
    }
    setHazardsLoading(false)
  }

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
  // Natural hazards: the tracts nearby shaded by their rating for the chosen hazard, the five ratings on the
  // same five shades, lightest for Very Low. A tract the hazard does not apply to is left clear.
  const hazardAreas = useMemo(() => {
    if (!hazardsWanted || !hazards) return [] as MapArea[]
    const column = HAZARD_CHOICES.indexOf(hazardChoice)
    return hazards.areas.map((area): MapArea => {
      const level = area.levels[column] ?? -1
      return { id: `hazard-${area.id}`, outline: area.outline, color: level < 0 ? null : shades[level], label: `${area.name}\n${hazardLabel(hazardChoice)}: ${level < 0 ? 'not rated' : HAZARD_RATINGS[level]}` }
    })
  }, [hazardsWanted, hazards, hazardChoice, shades])
  // Jobs: the block groups nearby shaded by jobs per acre, in up to five groups holding about the same
  // number of block groups each, like the demographics.
  const { jobAreas, jobLegend } = useMemo(() => {
    if (!jobsWanted || !jobs) return { jobAreas: [] as MapArea[], jobLegend: [] as { color: string; text: string }[] }
    const perAcre = (value: number) => `${value >= 10 ? Math.round(value).toLocaleString('en-US') : value.toFixed(1)} per acre`
    const values = jobs.areas.map((area) => area.jobsPerAcre).filter((value): value is number => value !== null)
    const limits = groupLimits(values)
    const shadeOf = (group: number) => shades[limits.length === 0 ? 2 : Math.round((group * (shades.length - 1)) / limits.length)]
    const shaded = jobs.areas.map((area): MapArea => ({
      id: `jobs-${area.id}`,
      outline: area.outline,
      color: area.jobsPerAcre === null ? null : shadeOf(limits.filter((limit) => area.jobsPerAcre! >= limit).length),
      label: `${whole(area.jobs)} jobs located here${area.jobsPerAcre === null ? '' : ` (${perAcre(area.jobsPerAcre)})`}\n${whole(area.workers)} workers live here`,
    }))
    const key = values.length === 0 ? [] : [...limits, Number.POSITIVE_INFINITY].map((limit, group) => ({
      color: shadeOf(group),
      text: group === 0 ? (limits.length === 0 ? 'All areas' : `Under ${perAcre(limit)}`) : limit === Number.POSITIVE_INFINITY ? `${perAcre(limits[group - 1])} or more` : `${perAcre(limits[group - 1])} to ${perAcre(limit)}`,
    }))
    return { jobAreas: shaded, jobLegend: key }
  }, [jobsWanted, jobs, shades])
  const drawn = useMemo(
    () => (areas || floodAreas.length > 0 || hazardAreas.length > 0 || jobAreas.length > 0 ? [...(areas ?? []), ...floodAreas, ...hazardAreas, ...jobAreas] : undefined),
    [areas, floodAreas, hazardAreas, jobAreas],
  )
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
  const reachMiles = wanted && profile ? DEMOGRAPHIC_MILES : floodWanted && flood ? flood.miles : schoolsWanted && schools ? schools.miles : transitWanted && transit ? transitReach : hazardsWanted && hazards && hazards.areas.length > 0 ? hazards.miles : jobsWanted && jobs && jobs.areas.length > 0 ? jobs.miles : 0
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
    if (next === 'hazards') void loadHazards(pin)
    if (next === 'jobs') void loadJobs(pin)
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

        {hazardsWanted && hazardsLoading ? <p className="note" role="status">Getting FEMA&apos;s hazard ratings. This can take a few seconds…</p> : null}
        {hazardsWanted && hazardsError ? (
          <>
            <p className="form-error" role="alert">{hazardsError}</p>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => around && void loadHazards(around)}>Try Again</button>
          </>
        ) : null}
        {hazardsWanted && hazards ? (
          <>
            {hazards.at ? (
              <>
                <div className="flood-at">
                  <span className="flood-at-label">This Area: Census Tract {hazards.at.tract}{hazards.at.county ? `, ${hazards.at.county}` : ''}{hazards.at.state ? `, ${hazards.at.state}` : ''}</span>
                  <strong>{hazards.at.overall ? `${HAZARD_RATINGS[hazards.at.overall.level]} Expected Loss` : 'No Overall Rating'}</strong>
                  <p>
                    {hazards.at.overall && hazards.at.overall.higherThan !== null
                      ? `All natural hazards together: expected yearly losses here are higher than in ${hazards.at.overall.higherThan}% of U.S. census tracts.`
                      : 'All natural hazards together, compared with other U.S. census tracts.'}
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="map-hazard">Shade the Map By</label>
                  <select id="map-hazard" value={hazardChoice} onChange={(event) => setHazardChoice(event.target.value as HazardChoice)}>
                    <option value="ALL">{hazardLabel('ALL')}</option>
                    {hazards.at.hazards.map((hazard) => (
                      <option key={hazard.key} value={hazard.key}>{hazard.label}</option>
                    ))}
                  </select>
                </div>
                {hazards.areas.length > 0 ? (
                  <ul className="map-legend" aria-label="Colors for hazard ratings">
                    {[...HAZARD_RATINGS].reverse().map((rating, index) => (
                      <li key={rating}><span className="map-swatch" style={{ background: shades[HAZARD_RATINGS.length - 1 - index] }} aria-hidden="true" />{rating}</li>
                    ))}
                    <li><span className="map-swatch map-swatch-empty" aria-hidden="true" />Not rated</li>
                  </ul>
                ) : null}
                {hazards.noMap ? <p className="note">The neighboring areas could not be loaded this time, so the map is not shaded.</p> : null}
                <h4 className="map-side-title">Hazards Here, Most Serious First</h4>
                <ul className="hazard-list">
                  {hazards.at.hazards.map((hazard) => (
                    <li key={hazard.key}>
                      <button type="button" className={`hazard-row${hazard.key === hazardChoice ? ' active' : ''}`} onClick={() => setHazardChoice(hazard.key)} title="Shade the map by this hazard">
                        <span className="map-swatch" style={{ background: shades[hazard.level] }} aria-hidden="true" />
                        <span className="hazard-name">{hazard.label}</span>
                        <span className="hazard-rating">{HAZARD_RATINGS[hazard.level]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {hazards.at.hazards.length === 0 ? <p className="note">FEMA rates no hazards for this area.</p> : null}
              </>
            ) : (
              <p className="note">FEMA&apos;s index has no ratings for this spot.</p>
            )}
            <p className="doc-sub">
              Source: FEMA National Risk Index{hazards.version ? `, ${hazards.version}` : ''}, by census tract. Ratings are of expected yearly
              loss and are relative to other tracts in the country: they reflect how often a hazard strikes and how much there is in the
              tract to damage, and are not a forecast for one building. Inland Flooding here is a tract-wide rating; the Flood Zones tab
              gives the zone at the address. The index&apos;s social vulnerability and community resilience scores are left out on purpose.
            </p>
          </>
        ) : null}

        {jobsWanted && jobsLoading ? <p className="note" role="status">Getting the jobs figures. This can take a few seconds…</p> : null}
        {jobsWanted && jobsError ? (
          <>
            <p className="form-error" role="alert">{jobsError}</p>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => around && void loadJobs(around)}>Try Again</button>
          </>
        ) : null}
        {jobsWanted && jobs ? (
          <>
            <div className="flood-at">
              <span className="flood-at-label">Jobs Nearby ({jobs.jobsYear} counts)</span>
              <strong>{jobs.rings[0] ? `${whole(jobs.rings[0].jobs)} jobs within ${jobs.rings[0].miles} mile` : jobs.at ? 'Jobs in the surrounding area could not be loaded' : 'No figures for this spot'}</strong>
              <dl>
                {jobs.rings.slice(1).map((total) => (
                  <div key={total.miles}><dt>Jobs Within {total.miles} Miles</dt><dd>{whole(total.jobs)}</dd></div>
                ))}
                {jobs.rings.length > 0 ? (
                  <div><dt>Workers Living Within {jobs.rings[jobs.rings.length - 1].miles} Miles</dt><dd>{whole(jobs.rings[jobs.rings.length - 1].workers)}</dd></div>
                ) : null}
                {jobs.at?.jobsByCar != null ? <div><dt>Jobs Within a 45-Minute Drive</dt><dd>{whole(jobs.at.jobsByCar)}</dd></div> : null}
                {jobs.at?.jobsByTransit != null && jobs.at.jobsByTransit > 0 ? <div><dt>Jobs Within 45 Minutes by Transit</dt><dd>{whole(jobs.at.jobsByTransit)}</dd></div> : null}
                {jobs.at?.walkability != null ? <div><dt>Walkability</dt><dd>{jobs.at.walkability} of 20, {jobs.at.walkabilityBand}</dd></div> : null}
              </dl>
            </div>
            {jobLegend.length > 0 ? (
              <ul className="map-legend" aria-label="Colors for jobs per acre">
                {jobLegend.map((entry) => (
                  <li key={entry.text}><span className="map-swatch" style={{ background: entry.color }} aria-hidden="true" />{entry.text}</li>
                ))}
              </ul>
            ) : null}
            {jobs.rings.length > 0 && jobs.rings[jobs.rings.length - 1].jobs > 0 ? (
              <div className="table-scroll">
                <table className="map-rings">
                  <caption>Kinds of Job Within {jobs.rings[jobs.rings.length - 1].miles} Miles</caption>
                  <tbody>
                    {[...JOB_SECTORS]
                      .sort((a, b) => jobs.rings[jobs.rings.length - 1].sectors[b.key] - jobs.rings[jobs.rings.length - 1].sectors[a.key])
                      .map((sector) => {
                        const outer = jobs.rings[jobs.rings.length - 1]
                        return (
                          <tr key={sector.key}>
                            <th scope="row">{sector.label}</th>
                            <td>{whole(outer.sectors[sector.key])}</td>
                            <td>{percent(outer.sectors[sector.key] / outer.jobs)}</td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            ) : null}
            {jobs.commute ? (
              <div className="table-scroll">
                <table className="map-rings">
                  <caption>How People Living Here Get to Work</caption>
                  <tbody>
                    <tr><th scope="row">Drive Alone</th><td>{percent(jobs.commute.droveAlone)}</td></tr>
                    <tr><th scope="row">Carpool</th><td>{percent(jobs.commute.carpooled)}</td></tr>
                    <tr><th scope="row">Public Transit</th><td>{percent(jobs.commute.transit)}</td></tr>
                    <tr><th scope="row">Walk or Bicycle</th><td>{percent(jobs.commute.walkedOrBiked)}</td></tr>
                    <tr><th scope="row">Work from Home</th><td>{percent(jobs.commute.workedFromHome)}</td></tr>
                    {jobs.commute.other >= 0.005 ? <tr><th scope="row">Other</th><td>{percent(jobs.commute.other)}</td></tr> : null}
                    {jobs.commute.minutes !== null ? <tr><th scope="row">Average Commute</th><td>{jobs.commute.minutes} minutes</td></tr> : null}
                  </tbody>
                </table>
              </div>
            ) : null}
            {jobs.missing.length > 0 ? <p className="note">Could not be loaded this time: {jobs.missing.join(', ')}.</p> : null}
            <p className="doc-sub">
              Sources: jobs, reach and walkability from the EPA Smart Location Database, version 3. Its job counts are the Census
              Bureau&apos;s for {jobs.jobsYear}, so they predate the pandemic; treat them as the shape of the job market, not today&apos;s
              count. Each shaded area is a census block group, counted toward a distance when its middle is within it. The 45-minute
              figures count nearer jobs for more.{jobs.commute ? ` Commuting is for the census tract, from the American Community Survey, ${jobs.commute.survey}.` : ''}
            </p>
          </>
        ) : null}
      </aside>
      ) : null}
      </div>
    </div>
  )
}
