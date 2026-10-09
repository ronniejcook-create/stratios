// Address suggestions while typing, from Google's Places API (New). Used only
// when GOOGLE_MAPS_API_KEY is set; without it the address form falls back to
// the type-then-find lookup in lib/geocode.ts.
//
// What comes from Google and what does not:
// - the suggestions shown under the box, and the parts of the address the
//   person picks (street, city, state, ZIP, suite);
// - NOT the latitude and longitude. Google's terms let coordinates from the
//   Places API be kept for 30 days only, and Stratios keeps them for good, so
//   the picked address is looked up with the Census service (lib/geocode.ts)
//   for its coordinates instead. `location` is deliberately never requested.
//
// The key stays on the server: the browser calls server actions, never Google.

export type Suggestion = { placeId: string; main: string; secondary: string }
export type PickedAddress = { street: string; suite: string | null; city: string; state: string; postalCode: string }

const BASE = 'https://places.googleapis.com/v1'
const TIMEOUT_MS = 8000

export const googleKey = (): string | null => process.env.GOOGLE_MAPS_API_KEY?.trim() || null
export const typeAheadEnabled = (): boolean => googleKey() !== null

/** Session tokens tie the keystrokes and the final pick together for billing. Only safe characters are let through. */
const cleanToken = (token: string) => (/^[A-Za-z0-9_-]{8,64}$/.test(token) ? token : null)

export type SuggestResult = { ok: true; suggestions: Suggestion[] } | { ok: false; error: string }

/** Reads Google's answer into suggestions. Anything that isn't a place with an id is dropped. */
export function readSuggestions(body: unknown): Suggestion[] {
  const raw = (body as { suggestions?: unknown } | null)?.suggestions
  if (!Array.isArray(raw)) return []
  const suggestions: Suggestion[] = []
  for (const entry of raw as { placePrediction?: { placeId?: unknown; text?: { text?: unknown }; structuredFormat?: { mainText?: { text?: unknown }; secondaryText?: { text?: unknown } } } }[]) {
    const prediction = entry?.placePrediction
    const placeId = typeof prediction?.placeId === 'string' ? prediction.placeId : ''
    if (!placeId || placeId.length > 400) continue
    const main = String(prediction?.structuredFormat?.mainText?.text ?? prediction?.text?.text ?? '').trim().slice(0, 200)
    if (!main) continue
    suggestions.push({ placeId, main, secondary: String(prediction?.structuredFormat?.secondaryText?.text ?? '').trim().slice(0, 200) })
    if (suggestions.length >= 5) break
  }
  return suggestions
}

/** Suggestions for what has been typed so far: street addresses and named buildings. */
export async function suggestAddresses(text: string, sessionToken: string): Promise<SuggestResult> {
  const key = googleKey()
  if (!key) return { ok: false, error: 'Address suggestions are not set up.' }
  const input = text.replace(/\s+/g, ' ').trim().slice(0, 200)
  if (input.length < 3) return { ok: true, suggestions: [] }
  const body: Record<string, unknown> = { input, includedPrimaryTypes: ['street_address', 'premise', 'subpremise'], languageCode: 'en' }
  const token = cleanToken(sessionToken)
  if (token) body.sessionToken = token
  try {
    const response = await fetch(`${BASE}/places:autocomplete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!response.ok) {
      console.error('Google address suggestions failed', response.status, (await response.text().catch(() => '')).slice(0, 300))
      return { ok: false, error: response.status === 403 ? 'Google refused the request. Check that Places API (New) is turned on for the key.' : 'Suggestions are not available right now.' }
    }
    return { ok: true, suggestions: readSuggestions(await response.json()) }
  } catch (error) {
    console.error('Google address suggestions could not be reached', error)
    return { ok: false, error: 'Suggestions are not available right now.' }
  }
}

type Component = { longText?: unknown; shortText?: unknown; types?: unknown }

/** Builds the address parts Stratios stores from Google's list of components. Null when there is no street or city. */
export function readAddress(body: unknown): PickedAddress | null {
  const components = (body as { addressComponents?: unknown } | null)?.addressComponents
  if (!Array.isArray(components)) return null
  const find = (type: string, short = false): string => {
    const component = (components as Component[]).find((entry) => Array.isArray(entry?.types) && (entry.types as unknown[]).includes(type))
    return String((short ? component?.shortText : component?.longText) ?? component?.longText ?? '').trim()
  }
  // "15400" + "Knoll Trail Drive"; a named building with no number keeps its name as the street line.
  const street = [find('street_number'), find('route')].filter(Boolean).join(' ') || find('premise')
  const city = find('locality') || find('postal_town') || find('sublocality_level_1') || find('sublocality') || find('administrative_area_level_3')
  if (!street || !city) return null
  const zip = [find('postal_code'), find('postal_code_suffix')].filter(Boolean)
  const subpremise = find('subpremise')
  return {
    street: street.slice(0, 200),
    // Google gives the bare number ("200"); "Suite 200" reads the way the rest of Stratios writes it.
    suite: subpremise ? (/^\d/.test(subpremise) ? `Suite ${subpremise}` : subpremise).slice(0, 200) : null,
    city: city.slice(0, 200),
    state: find('administrative_area_level_1', true).slice(0, 20),
    postalCode: (zip[0] ?? '').slice(0, 20),
  }
}

export type PickResult = { ok: true; address: PickedAddress } | { ok: false; error: string }

/** The parts of the address behind a suggestion the person picked. Ends the billing session started by the suggestions. */
export async function addressOfSuggestion(placeId: string, sessionToken: string): Promise<PickResult> {
  const key = googleKey()
  if (!key) return { ok: false, error: 'Address suggestions are not set up.' }
  if (!/^[A-Za-z0-9_-]{5,400}$/.test(placeId)) return { ok: false, error: 'That suggestion could not be opened. Pick it again.' }
  const token = cleanToken(sessionToken)
  try {
    const response = await fetch(`${BASE}/places/${placeId}${token ? `?sessionToken=${token}` : ''}`, {
      // Address parts only. Never add `location` here: see the note at the top of this file.
      headers: { 'x-goog-api-key': key, 'x-goog-fieldmask': 'id,addressComponents' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!response.ok) {
      console.error('Google place details failed', response.status, (await response.text().catch(() => '')).slice(0, 300))
      return { ok: false, error: 'That suggestion could not be opened. Try again, or use Find Address.' }
    }
    const address = readAddress(await response.json())
    return address ? { ok: true, address } : { ok: false, error: 'That suggestion is not a full street address. Pick another, or enter it by hand.' }
  } catch (error) {
    console.error('Google place details could not be reached', error)
    return { ok: false, error: 'That suggestion could not be opened. Try again, or use Find Address.' }
  }
}
