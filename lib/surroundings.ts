// What is around an address, in words and figures the Portfolio Analyst can answer from.
//
// The Map tab's layers (schools, transit, flood zones, natural hazards, jobs
// and commuting, demographics) each return outlines and long lists meant for
// drawing. This file asks the same sources and boils each answer down to a
// short summary: the facts a person would read off the side panel, without the
// shapes. Nothing here is stored.
//
// The same things the layers leave out on purpose stay out: no figures about
// who attends a school or lives in a tract beyond what the panels show.

import { areaProfile, type AreaProfile } from './demographics'
import { FLOOD_LABELS, FLOOD_MEANINGS, floodProfile, type FloodProfile } from './floodZones'
import { HAZARD_RATINGS, hazardProfile, type HazardProfile, type HazardRating } from './hazards'
import { JOB_SECTORS, jobsProfile, type JobsProfile } from './jobs'
import { SCHOOL_KINDS, SCHOOL_LABELS, SCHOOL_YEARS, schoolProfile, type School, type SchoolProfile } from './schools'
import { isRail, TRANSIT_KINDS, TRANSIT_LABELS, transitProfile, type TransitProfile, type TransitStop } from './transit'

export const SURROUNDING_TOPICS = ['schools', 'transit', 'flood_zone', 'natural_hazards', 'jobs_and_commuting', 'demographics'] as const
export type SurroundingTopic = (typeof SURROUNDING_TOPICS)[number]

export function isSurroundingTopic(value: unknown): value is SurroundingTopic {
  return typeof value === 'string' && (SURROUNDING_TOPICS as readonly string[]).includes(value)
}

/** How long one source may take before the analyst is told it could not be reached. */
const TOPIC_TIMEOUT_MS = 25000
const MAX_SCHOOLS = 12
const MAX_STATIONS = 8
const MAX_ROUTES = 25

const miles = (value: number) => Math.round(value * 100) / 100
const percent = (share: number | null) => (share === null ? null : Math.round(share * 1000) / 10)

function describeSchool(school: School) {
  return {
    name: school.name,
    kind: SCHOOL_LABELS[school.kind],
    miles_away: miles(school.miles),
    address: school.address || undefined,
    grades: school.grades ?? undefined,
    students: school.students ?? undefined,
    students_per_teacher: school.studentsPerTeacher ?? undefined,
    run_by: school.operator ?? undefined,
    charter: school.charter || undefined,
    run_by_another_district_than_the_address_is_in: school.operator && !school.inDistrict && !school.charter ? true : undefined,
  }
}

export function summarizeSchools(profile: SchoolProfile) {
  const nearest: Record<string, ReturnType<typeof describeSchool>> = {}
  for (const kind of SCHOOL_KINDS) {
    const first = profile.schools.find((school) => school.kind === kind)
    if (first) nearest[SCHOOL_LABELS[kind]] = describeSchool(first)
  }
  return {
    school_district_the_address_is_in: profile.district
      ? { name: profile.district.name, grades: profile.district.grades ?? undefined, schools: profile.district.schools ?? undefined, students: profile.district.students ?? undefined }
      : null,
    within_miles: profile.miles,
    how_many_of_each_kind: Object.fromEntries(SCHOOL_KINDS.map((kind) => [SCHOOL_LABELS[kind], profile.counts[kind]])),
    nearest_of_each_kind: nearest,
    nearest_schools: profile.schools.slice(0, MAX_SCHOOLS).map(describeSchool),
    could_not_be_loaded: profile.missing.length > 0 ? profile.missing : undefined,
    source: `National Center for Education Statistics (public schools ${SCHOOL_YEARS.public}, private ${SCHOOL_YEARS.private}, colleges ${SCHOOL_YEARS.college})`,
    keep_in_mind: 'Distances are straight lines. The nearest school is not always the assigned one: attendance zones are not in this data. There are no ratings or test scores.',
  }
}

const describeStop = (stop: TransitStop | null) => (stop ? { name: stop.name, kind: TRANSIT_LABELS[stop.kind], miles_away: miles(stop.miles) } : null)

export function summarizeTransit(profile: TransitProfile) {
  return {
    nearest_rail_station: describeStop(profile.nearestRail),
    nearest_bus_stop: describeStop(profile.nearestBus),
    [`stops_within_${profile.walkMiles}_mile`]: Object.fromEntries(TRANSIT_KINDS.filter((kind) => profile.walkCounts[kind] > 0).map((kind) => [TRANSIT_LABELS[kind], profile.walkCounts[kind]])),
    [`rail_stations_within_${profile.railMiles}_miles`]: profile.stops.filter((stop) => isRail(stop.kind)).slice(0, MAX_STATIONS).map(describeStop),
    routes_passing_nearby: profile.routes.slice(0, MAX_ROUTES).map((route) => ({ number: route.number || undefined, name: route.name || undefined, kind: TRANSIT_LABELS[route.kind], agency: route.agency || undefined })),
    more_routes_than_listed: profile.routes.length > MAX_ROUTES || profile.partial || undefined,
    schedules_gathered: profile.asOf ?? undefined,
    could_not_be_loaded: profile.missing.length > 0 ? profile.missing : undefined,
    source: 'National Transit Map, U.S. Department of Transportation',
    keep_in_mind: 'Agencies take part by choice, so a small system may be missing. Amtrak and intercity buses are not included. It shows where service runs, not how often.',
  }
}

export function summarizeFlood(profile: FloodProfile) {
  return {
    at_the_address: profile.at
      ? {
          fema_zone: profile.at.zone,
          group: FLOOD_LABELS[profile.at.kind],
          meaning: FLOOD_MEANINGS[profile.at.kind],
          special_flood_hazard_area: profile.at.special,
          fema_description: profile.at.detail || undefined,
          base_flood_elevation: profile.at.elevation ?? undefined,
        }
      : null,
    nothing_mapped_at_the_address: profile.at ? undefined : true,
    [`other_zones_within_about_${profile.miles}_mile`]: profile.kinds.map((kind) => FLOOD_LABELS[kind]),
    source: "FEMA's National Flood Hazard Layer",
    keep_in_mind: 'The map point sits along the street, not on the building, and this is not an official flood determination.',
  }
}

const describeRating = (rating: HazardRating) => ({ hazard: rating.label, rating: HAZARD_RATINGS[rating.level] ?? 'Not rated', higher_than_percent_of_us_census_tracts: rating.higherThan ?? undefined })

export function summarizeHazards(profile: HazardProfile) {
  return {
    area: profile.at ? { census_tract: profile.at.tract, county: profile.at.county, state: profile.at.state } : null,
    overall: profile.at?.overall ? describeRating(profile.at.overall) : null,
    hazards_rated_here_most_serious_first: (profile.at?.hazards ?? []).map(describeRating),
    source: `FEMA's National Risk Index${profile.version ? `, ${profile.version}` : ''} (expected annual loss)`,
    keep_in_mind: 'Ratings are for the whole census tract and are relative to other tracts; they reflect how much there is to damage as well as how often a hazard strikes. They are not a forecast for one building. For flooding at the address itself use the flood zone.',
  }
}

export function summarizeJobs(profile: JobsProfile) {
  const commute = profile.commute
  return {
    metro_area: profile.at?.metro || undefined,
    jobs_and_resident_workers_by_distance: profile.rings.map((ring) => ({
      within_miles: ring.miles,
      jobs: ring.jobs,
      workers_living_there: ring.workers,
      jobs_by_kind: Object.fromEntries(JOB_SECTORS.filter((sector) => ring.sectors[sector.key] > 0).map((sector) => [sector.label, ring.sectors[sector.key]])),
    })),
    jobs_within_a_45_minute_drive: profile.at?.jobsByCar ?? undefined,
    jobs_within_45_minutes_by_transit: profile.at?.jobsByTransit ?? undefined,
    walkability_score_1_to_20: profile.at?.walkability ?? undefined,
    walkability: profile.at?.walkabilityBand ?? undefined,
    job_counts_are_for_the_year: profile.jobsYear,
    how_people_living_here_get_to_work: commute
      ? {
          survey: commute.survey,
          drove_alone_percent: percent(commute.droveAlone),
          carpooled_percent: percent(commute.carpooled),
          transit_percent: percent(commute.transit),
          walked_or_cycled_percent: percent(commute.walkedOrBiked),
          worked_from_home_percent: percent(commute.workedFromHome),
          other_percent: percent(commute.other),
          average_minutes_one_way: commute.minutes ?? undefined,
        }
      : null,
    could_not_be_loaded: profile.missing.length > 0 ? profile.missing : undefined,
    source: 'EPA Smart Location Database (jobs) and the American Community Survey (commuting)',
    keep_in_mind: `The job counts are the Census Bureau's for ${profile.jobsYear}, so say the year when you give them. Commuting figures are for the census tract the address is in.`,
  }
}

export function summarizeDemographics(profile: AreaProfile) {
  return {
    by_distance: profile.rings.map((ring) => ({
      within_miles: ring.miles,
      population: Math.round(ring.population),
      households: Math.round(ring.households),
      average_household_income: ring.averageIncome === null ? undefined : Math.round(ring.averageIncome),
      homes_rented_percent: percent(ring.renterShare) ?? undefined,
      adults_with_a_bachelors_degree_or_more_percent: percent(ring.bachelorsShare) ?? undefined,
    })),
    source: `U.S. Census Bureau, American Community Survey ${profile.survey}`,
    keep_in_mind: 'These are estimates. Totals count each census tract by the share of its land within the distance. Income is an average, not a median.',
  }
}

type Lookup = (latitude: number, longitude: number) => Promise<{ ok: true; summary: object } | { ok: false; error: string }>

const LOOKUPS: Record<SurroundingTopic, Lookup> = {
  schools: async (latitude, longitude) => {
    const result = await schoolProfile(latitude, longitude)
    return result.ok ? { ok: true, summary: summarizeSchools(result.profile) } : result
  },
  transit: async (latitude, longitude) => {
    const result = await transitProfile(latitude, longitude)
    return result.ok ? { ok: true, summary: summarizeTransit(result.profile) } : result
  },
  flood_zone: async (latitude, longitude) => {
    const result = await floodProfile(latitude, longitude)
    return result.ok ? { ok: true, summary: summarizeFlood(result.profile) } : result
  },
  natural_hazards: async (latitude, longitude) => {
    const result = await hazardProfile(latitude, longitude)
    return result.ok ? { ok: true, summary: summarizeHazards(result.profile) } : result
  },
  jobs_and_commuting: async (latitude, longitude) => {
    const result = await jobsProfile(latitude, longitude)
    return result.ok ? { ok: true, summary: summarizeJobs(result.profile) } : result
  },
  demographics: async (latitude, longitude) => {
    const result = await areaProfile(latitude, longitude)
    return result.ok ? { ok: true, summary: summarizeDemographics(result.profile) } : result
  },
}

/**
 * Looks up the chosen topics around a point, all at once. A topic whose
 * source fails or is slow comes back as `{ could_not_be_loaded: reason }`
 * and never holds up the others.
 */
export async function lookUpSurroundings(latitude: number, longitude: number, topics: SurroundingTopic[], timeoutMs = TOPIC_TIMEOUT_MS): Promise<Record<string, object>> {
  const wanted = [...new Set(topics)]
  const answers = await Promise.all(
    wanted.map(async (topic) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const late = new Promise<{ ok: false; error: string }>((resolve) => {
          timer = setTimeout(() => resolve({ ok: false, error: 'The source took too long to answer. Try again in a minute.' }), timeoutMs)
        })
        const result = await Promise.race([LOOKUPS[topic](latitude, longitude), late])
        return [topic, result.ok ? result.summary : { could_not_be_loaded: result.error }] as const
      } catch (error) {
        console.error(`Looking up ${topic} for the analyst failed`, error)
        return [topic, { could_not_be_loaded: 'The source could not be reached.' }] as const
      } finally {
        if (timer) clearTimeout(timer)
      }
    }),
  )
  return Object.fromEntries(answers)
}
