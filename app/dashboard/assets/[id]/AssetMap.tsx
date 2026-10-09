'use client'

import { useMemo, useState } from 'react'
import { PropertyMap, type MapArea, type MapPin } from '@/components/PropertyMap'
import type { AreaProfile, TractArea } from '@/lib/demographics'

/** What the neighborhoods can be shaded by. Each reads one figure from a census tract and says how to write it. */
const MEASURES = [
  { key: 'medianIncome', label: 'Median Household Income', value: (tract: TractArea) => tract.medianIncome, format: (value: number) => `$${Math.round(value / 1000) * 1000 >= 1000 ? (Math.round(value / 1000) * 1000).toLocaleString('en-US') : Math.round(value).toLocaleString('en-US')}` },
  { key: 'density', label: 'Population Density', value: (tract: TractArea) => tract.density, format: (value: number) => `${(Math.round(value / 100) * 100).toLocaleString('en-US')} per sq mi` },
  { key: 'medianAge', label: 'Median Age', value: (tract: TractArea) => tract.medianAge, format: (value: number) => value.toFixed(1) },
  { key: 'renterShare', label: 'Homes That Are Rented', value: (tract: TractArea) => tract.renterShare, format: (value: number) => `${Math.round(value * 100)}%` },
  { key: 'bachelorsShare', label: "Adults with a Bachelor's Degree or More", value: (tract: TractArea) => tract.bachelorsShare, format: (value: number) => `${Math.round(value * 100)}%` },
] as const
type MeasureKey = (typeof MEASURES)[number]['key']

/** One hue, light to dark: lighter is less, darker is more. */
const SHADES = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b']

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

/**
 * The Map tab's contents: the map with its pins, and on request the census
 * picture around one of them: neighborhoods shaded by a chosen figure, rings
 * at 1, 3 and 5 miles, and a table of estimated totals inside each ring.
 */
export function AssetMap({ pins }: { pins: MapPin[] }) {
  const [aroundId, setAroundId] = useState(pins[0]?.id ?? '')
  const [profiles, setProfiles] = useState<Record<string, AreaProfile>>({})
  const [wanted, setWanted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [measure, setMeasure] = useState<MeasureKey | ''>('medianIncome')
  const [showRings, setShowRings] = useState(true)

  const around = pins.find((pin) => pin.id === aroundId) ?? pins[0]
  const profile = around ? profiles[around.id] : undefined

  const load = async (pin: MapPin) => {
    setWanted(true)
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

  const chosen = MEASURES.find((entry) => entry.key === measure)
  const { areas, legend } = useMemo(() => {
    if (!wanted || !profile || !chosen) return { areas: undefined as MapArea[] | undefined, legend: [] as { color: string; text: string }[] }
    const values = profile.tracts.map((tract) => chosen.value(tract)).filter((value): value is number => value !== null)
    const limits = groupLimits(values)
    // With fewer groups than shades, spread them across the light-to-dark range.
    const shadeOf = (group: number) => SHADES[limits.length === 0 ? 2 : Math.round((group * (SHADES.length - 1)) / limits.length)]
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
  }, [wanted, profile, chosen])

  const rings = wanted && profile && showRings && around ? { center: [around.latitude, around.longitude] as [number, number], miles: profile.rings.map((ring) => ring.miles) } : null

  return (
    <div className="map-layout">
      <div className="map-main">
        <PropertyMap pins={pins} areas={areas} rings={rings} />
      </div>

      <aside className="map-side" aria-label="Demographics">
        <h3>Demographics</h3>
        {pins.length > 1 ? (
          <div className="field">
            <label htmlFor="map-around">Around</label>
            <select
              id="map-around"
              value={around?.id ?? ''}
              onChange={(event) => {
                setAroundId(event.target.value)
                const next = pins.find((pin) => pin.id === event.target.value)
                if (wanted && next) void load(next)
              }}
            >
              {pins.map((pin) => (
                <option key={pin.id} value={pin.id}>{pin.title}: {pin.address}</option>
              ))}
            </select>
          </div>
        ) : null}

        {!wanted ? (
          <>
            <p className="note">Census figures for the neighborhoods around this address, with totals within 1, 3 and 5 miles.</p>
            <button type="button" className="btn btn-primary btn-small" disabled={!around} onClick={() => around && void load(around)}>Show Demographics</button>
          </>
        ) : null}

        {loading ? <p className="note" role="status">Getting census figures. The first time for an address can take a few seconds…</p> : null}
        {error ? (
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

            <label className="map-check">
              <input type="checkbox" checked={showRings} onChange={(event) => setShowRings(event.target.checked)} />
              Show 1, 3 and 5 Mile Rings
            </label>

            <div className="table-scroll">
              <table className="map-rings">
                <caption>Estimated Within Each Ring</caption>
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
              Source: U.S. Census Bureau, American Community Survey, {profile.survey}. Each shaded area is a census tract. Ring figures are
              estimates: a tract a ring cuts through counts by the share of its land inside the ring.
            </p>
            <button type="button" className="link-button" onClick={() => setWanted(false)}>Hide Demographics</button>
          </>
        ) : null}
      </aside>
    </div>
  )
}
