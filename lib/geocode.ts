// Looks up a typed address and returns the matches as tidy parts (street,
// city, state, ZIP) with their latitude and longitude.
//
// The lookup service is the U.S. Census Bureau's geocoder: free, no account
// or key, and its results may be stored. Its limits: United States addresses
// only, no suggestions while typing, no suite numbers, and the location is
// worked out along the street's range of house numbers, so the point lands
// on the right block rather than exactly on the building. All of that lives
// in this file, so another service can be swapped in later.

export type AddressMatch = {
  street: string
  city: string
  state: string
  postalCode: string
  latitude: number
  longitude: number
}
/** An address ready to be added: its parts, an optional suite, and its place on the map when one was found. */
export type FoundAddress = { street: string; suite: string | null; city: string; state: string; postalCode: string; latitude: number | null; longitude: number | null }
export type LookupResult = { ok: true; matches: AddressMatch[] } | { ok: false; error: string }

const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
export const LOCATION_SOURCE = 'census'
const MAX_MATCHES = 5

/** Words kept in capitals when the service's ALL-CAPS answer is tidied: compass points on a street name. */
const KEEP_UPPER = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'])

/** "15400 KNOLL TRAIL DR" -> "15400 Knoll Trail Dr"; "MCKINNEY" stays "Mckinney" (the service gives no better). */
export function tidyCase(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase()
      // 1ST, 42ND: the digits stay, the ending is lower case.
      if (/^\d+[A-Z]+$/i.test(word)) return word.toLowerCase()
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

type RawMatch = {
  matchedAddress?: unknown
  coordinates?: { x?: unknown; y?: unknown }
  addressComponents?: { city?: unknown; state?: unknown; zip?: unknown }
}

/** Turns the service's answer into matches. Anything without a usable street and location is dropped. */
export function readMatches(body: unknown): AddressMatch[] {
  const raw = (body as { result?: { addressMatches?: unknown } } | null)?.result?.addressMatches
  if (!Array.isArray(raw)) return []
  const matches: AddressMatch[] = []
  for (const entry of raw as RawMatch[]) {
    const latitude = Number(entry?.coordinates?.y)
    const longitude = Number(entry?.coordinates?.x)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue
    // "15400 KNOLL TRAIL DR, DALLAS, TX, 75248": the street is everything before the first comma.
    const street = tidyCase(String(entry.matchedAddress ?? '').split(',')[0] ?? '')
    const city = tidyCase(String(entry.addressComponents?.city ?? ''))
    const state = String(entry.addressComponents?.state ?? '').trim().toUpperCase()
    const postalCode = String(entry.addressComponents?.zip ?? '').trim()
    if (!street || !city) continue
    const match = { street: street.slice(0, 200), city: city.slice(0, 200), state: state.slice(0, 20), postalCode: postalCode.slice(0, 20), latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) }
    if (matches.some((other) => other.street === match.street && other.city === match.city && other.postalCode === match.postalCode)) continue
    matches.push(match)
    if (matches.length >= MAX_MATCHES) break
  }
  return matches
}

/** Finds a typed address. An address that isn't found is `ok` with no matches; `ok: false` means the lookup itself failed. */
export async function lookUpAddress(text: string, timeoutMs = 12000): Promise<LookupResult> {
  const address = text.replace(/\s+/g, ' ').trim().slice(0, 300)
  if (address.length < 5) return { ok: false, error: 'Type the street address with its city and state, for example 100 Main St, Dallas, TX.' }
  const query = new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'json' })
  try {
    const response = await fetch(`${ENDPOINT}?${query}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' }, cache: 'no-store' })
    if (!response.ok) return { ok: false, error: 'The address lookup is not answering right now. Try again, or enter the address by hand.' }
    return { ok: true, matches: readMatches(await response.json()) }
  } catch (error) {
    console.error('Address lookup failed', error)
    return { ok: false, error: 'The address lookup could not be reached. Try again, or enter the address by hand.' }
  }
}
