'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { FoundAddress } from '@/lib/geocode'
import type { Suggestion } from '@/lib/googlePlaces'
import { addAddress, addChild, findAddress, locateAddress, pickSuggestedAddress, removeAddress, suggestAddress, type AddState } from './actions'

const initialState: AddState = { error: null, done: 0 }

const LABELS = { property: 'Property', building: 'Building', floor: 'Floor', unit: 'Unit' } as const
const PLACEHOLDERS = { property: 'Property name', building: 'Building name', floor: 'Floor 1', unit: 'Suite 100' } as const

/** A small "Add ..." button that opens a one-line form for a new property, building, floor or unit. */
export function AddChildForm({
  type,
  parentId,
  assetId,
  propertyTypes,
}: {
  type: keyof typeof LABELS
  parentId: string
  assetId: string
  propertyTypes?: readonly string[]
}) {
  const [state, formAction, pending] = useActionState(addChild, initialState)
  const [open, setOpen] = useState(false)
  // Close the form after each successful add.
  useEffect(() => {
    if (state.done > 0) setOpen(false)
  }, [state.done])

  const label = LABELS[type]
  const inputId = `add-${type}-${parentId}`

  if (!open) {
    return (
      <button type="button" className="link-button add-link" onClick={() => setOpen(true)}>
        + Add {label}
      </button>
    )
  }
  return (
    <form action={formAction} className="inline-form">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="parentId" value={parentId} />
      <input type="hidden" name="assetId" value={assetId} />
      <div className="field">
        <label htmlFor={inputId}>{label} Name</label>
        <input id={inputId} name="name" type="text" required maxLength={200} placeholder={PLACEHOLDERS[type]} autoFocus />
      </div>
      {type === 'property' && propertyTypes ? (
        <div className="field">
          <label htmlFor={`${inputId}-type`}>Property Type</label>
          <select id={`${inputId}-type`} name="propertyType" defaultValue={propertyTypes[0]}>
            {propertyTypes.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field-edit-buttons">
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>{pending ? 'Adding…' : `Add ${label}`}</button>
        <button type="button" className="btn btn-ghost btn-small" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    </form>
  )
}

const matchLine = (match: FoundAddress) => [match.street, match.suite, match.city, [match.state, match.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')

/** A fresh label for one round of suggestions, which Google uses to bill the keystrokes and the pick as one. */
const newSession = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`)

/**
 * "+ Add Address": one box for the whole address.
 * - With suggestions on (`typeAhead`, a Google key is set), matching addresses
 *   appear under the box while typing; picking one fills in its parts.
 * - Find Address looks the typed text up without suggestions (the Census
 *   lookup), which also works when suggestions are off.
 * Either way the address is shown with its map location before it is added,
 * and "Enter It by Hand" keeps the five separate boxes.
 */
export function AddAddressForm({
  ownerType,
  ownerId,
  assetId,
  typeAhead = false,
}: {
  ownerType: 'property' | 'building' | 'unit'
  ownerId: string
  assetId: string
  typeAhead?: boolean
}) {
  const [state, formAction, pending] = useActionState(addAddress, initialState)
  const [open, setOpen] = useState(false)
  const [byHand, setByHand] = useState(false)
  const [text, setText] = useState('')
  const [matches, setMatches] = useState<FoundAddress[] | null>(null)
  const [picked, setPicked] = useState(0)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [looking, startLooking] = useTransition()
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [active, setActive] = useState(-1)
  const [suggestionsOff, setSuggestionsOff] = useState<string | null>(null)
  const session = useRef('')
  const latest = useRef(0)

  const reset = () => {
    setOpen(false)
    setByHand(false)
    setText('')
    setMatches(null)
    setPicked(0)
    setLookupError(null)
    setSuggestions([])
    setActive(-1)
    latest.current += 1
  }
  useEffect(() => {
    if (state.done > 0) reset()
  }, [state.done])

  // Ask for suggestions a moment after the typing pauses; an answer for older text is ignored.
  // Not while a pick or a lookup is in flight: the box's text changes then, and that is not typing.
  const wantSuggestions = typeAhead && suggestionsOff === null && open && !byHand && matches === null && !looking
  useEffect(() => {
    if (!wantSuggestions) return
    const typed = text.trim()
    if (typed.length < 3) {
      setSuggestions([])
      return
    }
    const request = (latest.current += 1)
    const timer = window.setTimeout(async () => {
      if (!session.current) session.current = newSession()
      const result = await suggestAddress({ text: typed, session: session.current })
      if (request !== latest.current) return
      if (!result.ok) {
        // Suggestions are a convenience: if they fail, stop asking, say why, and leave Find Address to do the job.
        setSuggestionsOff(result.error)
        setSuggestions([])
        return
      }
      setSuggestions(result.suggestions)
      setActive(-1)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [text, wantSuggestions])

  const show = (found: FoundAddress[]) => {
    latest.current += 1 // any suggestions still on their way are for text that has been dealt with
    setMatches(found)
    setPicked(0)
    setSuggestions([])
    setActive(-1)
  }

  const find = () => {
    setLookupError(null)
    setMatches(null)
    setSuggestions([])
    latest.current += 1
    startLooking(async () => {
      const result = await findAddress({ text })
      if (!result.ok) {
        setLookupError(result.error)
        return
      }
      show(result.matches.map((match) => ({ ...match, suite: null })))
    })
  }

  const choose = (suggestion: Suggestion) => {
    setLookupError(null)
    setSuggestions([])
    latest.current += 1
    setText([suggestion.main, suggestion.secondary].filter(Boolean).join(', '))
    startLooking(async () => {
      const result = await pickSuggestedAddress({ placeId: suggestion.placeId, session: session.current })
      session.current = '' // the pick closes this round; the next typing starts a new one
      if (!result.ok) {
        setLookupError(result.error)
        return
      }
      show([result.address])
    })
  }

  const id = `address-${ownerId}`
  if (!open) {
    return (
      <button type="button" className="link-button add-link" onClick={() => setOpen(true)}>
        + Add Address
      </button>
    )
  }

  const owner = (
    <>
      <input type="hidden" name="ownerType" value={ownerType} />
      <input type="hidden" name="ownerId" value={ownerId} />
      <input type="hidden" name="assetId" value={assetId} />
    </>
  )

  if (byHand) {
    return (
      <form action={formAction} className="inline-form">
        {owner}
        <div className="field field-wide">
          <label htmlFor={`${id}-street`}>Street</label>
          <input id={`${id}-street`} name="street" type="text" maxLength={200} placeholder="100 Main St" autoFocus />
        </div>
        <div className="field field-narrow">
          <label htmlFor={`${id}-suite`}>Suite</label>
          <input id={`${id}-suite`} name="suite" type="text" maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-city`}>City</label>
          <input id={`${id}-city`} name="city" type="text" maxLength={200} />
        </div>
        <div className="field field-narrow">
          <label htmlFor={`${id}-state`}>State</label>
          <input id={`${id}-state`} name="state" type="text" maxLength={200} />
        </div>
        <div className="field field-narrow">
          <label htmlFor={`${id}-postal`}>Postal Code</label>
          <input id={`${id}-postal`} name="postalCode" type="text" maxLength={200} />
        </div>
        <div className="field-edit-buttons">
          <button type="submit" className="btn btn-primary btn-small" disabled={pending}>{pending ? 'Adding…' : 'Add Address'}</button>
          <button type="button" className="btn btn-ghost btn-small" disabled={pending} onClick={() => setByHand(false)}>Back to Lookup</button>
          <button type="button" className="btn btn-ghost btn-small" disabled={pending} onClick={reset}>Cancel</button>
        </div>
        <p className="note address-note">An address entered by hand has no map location until you use Find Location on it.</p>
        {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      </form>
    )
  }

  const match = matches?.[picked]
  const listOpen = suggestions.length > 0
  const suggesting = typeAhead && suggestionsOff === null
  return (
    <div className="address-lookup">
      <div className="inline-form">
        <div className="field field-wide address-box">
          <label htmlFor={`${id}-text`}>Address</label>
          <input
            id={`${id}-text`}
            type="text"
            maxLength={300}
            placeholder={suggesting ? 'Start typing an address' : '15400 Knoll Trail Dr, Dallas, TX'}
            autoFocus
            autoComplete="off"
            role="combobox"
            aria-expanded={listOpen}
            aria-controls={`${id}-suggestions`}
            aria-autocomplete="list"
            aria-activedescendant={listOpen && active >= 0 ? `${id}-suggestion-${active}` : undefined}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setMatches(null)
              setLookupError(null)
            }}
            onKeyDown={(event) => {
              if (listOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault()
                setActive((current) => (event.key === 'ArrowDown' ? (current + 1) % suggestions.length : (current <= 0 ? suggestions.length : current) - 1))
                return
              }
              if (listOpen && event.key === 'Escape') {
                event.preventDefault()
                setSuggestions([])
                return
              }
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (looking) return
              if (listOpen && active >= 0) choose(suggestions[active])
              else if (text.trim()) find()
            }}
          />
          {listOpen ? (
            <ul id={`${id}-suggestions`} className="address-suggestions" role="listbox" aria-label="Suggested addresses">
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion.placeId}
                  id={`${id}-suggestion-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={index === active ? 'active' : undefined}
                  // mousedown, so the pick lands before the box loses focus
                  onMouseDown={(event) => {
                    event.preventDefault()
                    choose(suggestion)
                  }}
                  onMouseEnter={() => setActive(index)}
                >
                  <span className="address-suggestion-main">{suggestion.main}</span>
                  {suggestion.secondary ? <span className="address-suggestion-rest">{suggestion.secondary}</span> : null}
                </li>
              ))}
              <li className="address-suggestions-credit" aria-hidden="true">Powered by Google</li>
            </ul>
          ) : null}
        </div>
        <div className="field-edit-buttons">
          <button type="button" className="btn btn-primary btn-small" disabled={looking || pending || text.trim().length === 0} onClick={find}>{looking ? 'Looking…' : 'Find Address'}</button>
          <button type="button" className="btn btn-ghost btn-small" disabled={looking || pending} onClick={reset}>Cancel</button>
        </div>
      </div>
      <p className="note address-note">
        {suggesting
          ? 'Start typing and pick the address from the list, or type it all and use Find Address.'
          : 'Type the street address with its city and state, then Find Address. United States addresses only.'}{' '}
        <button type="button" className="link-button" onClick={() => setByHand(true)}>Enter It by Hand</button> instead.
      </p>
      {suggestionsOff ? (
        <p className="note address-note" role="status">
          Suggestions while typing are off for now. {suggestionsOff} Find Address still works.
        </p>
      ) : null}
      {lookupError ? <p className="form-error" role="alert">{lookupError}</p> : null}

      {matches && matches.length === 0 ? (
        <p className="form-error" role="alert">
          No address was found for that. Check the spelling and include the city and state, or{' '}
          <button type="button" className="link-button" onClick={() => setByHand(true)}>Enter It by Hand</button>.
        </p>
      ) : null}

      {matches && match ? (
        <form action={formAction} className="address-found">
          {owner}
          <input type="hidden" name="street" value={match.street} />
          <input type="hidden" name="city" value={match.city} />
          <input type="hidden" name="state" value={match.state} />
          <input type="hidden" name="postalCode" value={match.postalCode} />
          {/* A suite is kept only when the picked suggestion itself has one; there is no box to type it. */}
          {match.suite ? <input type="hidden" name="suite" value={match.suite} /> : null}
          {match.latitude !== null && match.longitude !== null ? (
            <>
              <input type="hidden" name="latitude" value={match.latitude} />
              <input type="hidden" name="longitude" value={match.longitude} />
            </>
          ) : null}
          {matches.length === 1 ? (
            <p className="address-match"><strong>{matchLine(match)}</strong></p>
          ) : (
            <fieldset className="address-choices">
              <legend>{matches.length} addresses match. Choose one:</legend>
              {matches.map((option, index) => (
                <label key={`${option.street}|${option.postalCode}`}>
                  <input type="radio" name={`${id}-choice`} checked={index === picked} onChange={() => setPicked(index)} />
                  {matchLine(option)}
                </label>
              ))}
            </fieldset>
          )}
          {match.latitude !== null && match.longitude !== null ? (
            <p className="doc-sub">
              Map location: {match.latitude.toFixed(5)}, {match.longitude.toFixed(5)} ·{' '}
              <a href={mapLink(match.latitude, match.longitude)} target="_blank" rel="noreferrer">Check on a Map</a>
            </p>
          ) : (
            <p className="doc-sub">No map location was found for this address. You can still add it, and try Find Location on it later.</p>
          )}
          <div className="field-edit-buttons address-add">
            <button type="submit" className="btn btn-primary btn-small" disabled={pending}>{pending ? 'Adding…' : 'Add This Address'}</button>
          </div>
          {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
        </form>
      ) : null}
    </div>
  )
}

/** Opens the spot in Google Maps in a new tab. */
const mapLink = (latitude: number, longitude: number) => `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`

export type AddressRow = { id: string; text: string; latitude: number | null; longitude: number | null; hasStreet: boolean }

/**
 * The addresses of a property or building. Each shows a Map link once it has
 * a location; people who can edit can find the location of an address typed
 * by hand, and remove an address.
 */
export function AddressList({ addresses, canEdit }: { addresses: AddressRow[]; canEdit: boolean }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (addresses.length === 0) return null

  const act = (work: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null)
    start(async () => {
      const result = await work()
      setRemoving(null)
      if (!result.ok) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <>
      <ul className="address-list">
        {addresses.map((address) => {
          const located = address.latitude !== null && address.longitude !== null
          return (
            <li key={address.id}>
              <span>{address.text}</span>
              {located ? (
                <a className="address-action" href={mapLink(address.latitude!, address.longitude!)} target="_blank" rel="noreferrer" title={`Latitude ${address.latitude}, longitude ${address.longitude}`}>Map</a>
              ) : canEdit && address.hasStreet ? (
                <button type="button" className="link-button address-action" disabled={busy} onClick={() => act(() => locateAddress({ addressId: address.id }))} title="Looks the address up and saves its latitude and longitude">Find Location</button>
              ) : null}
              {canEdit ? (
                removing === address.id ? (
                  <>
                    <button type="button" className="link-button danger address-action" disabled={busy} onClick={() => act(() => removeAddress({ addressId: address.id }))}>Confirm Remove</button>
                    <button type="button" className="link-button address-action" disabled={busy} onClick={() => setRemoving(null)}>Cancel</button>
                  </>
                ) : (
                  <button type="button" className="link-button address-action" disabled={busy} onClick={() => setRemoving(address.id)}>Remove</button>
                )
              ) : null}
            </li>
          )
        })}
      </ul>
      {error ? <p className="form-error address-error" role="alert">{error}</p> : null}
    </>
  )
}
