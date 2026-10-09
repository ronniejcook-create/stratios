'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { AddressMatch } from '@/lib/geocode'
import { addAddress, addChild, findAddress, locateAddress, removeAddress, type AddState } from './actions'

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

const matchLine = (match: AddressMatch) => `${match.street}, ${match.city}, ${[match.state, match.postalCode].filter(Boolean).join(' ')}`

/**
 * "+ Add Address": type the whole address in one box and look it up. Picking
 * a match saves its street, city, state and ZIP together with its latitude
 * and longitude. The five separate boxes are still there under "Enter It by
 * Hand" for addresses the lookup doesn't know (it covers the United States).
 */
export function AddAddressForm({ ownerType, ownerId, assetId }: { ownerType: 'property' | 'building' | 'unit'; ownerId: string; assetId: string }) {
  const [state, formAction, pending] = useActionState(addAddress, initialState)
  const [open, setOpen] = useState(false)
  const [byHand, setByHand] = useState(false)
  const [text, setText] = useState('')
  const [suite, setSuite] = useState('')
  const [matches, setMatches] = useState<AddressMatch[] | null>(null)
  const [picked, setPicked] = useState(0)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [looking, startLooking] = useTransition()

  const reset = () => {
    setOpen(false)
    setByHand(false)
    setText('')
    setSuite('')
    setMatches(null)
    setPicked(0)
    setLookupError(null)
  }
  useEffect(() => {
    if (state.done > 0) reset()
  }, [state.done])

  const find = () => {
    setLookupError(null)
    setMatches(null)
    startLooking(async () => {
      const result = await findAddress({ text })
      if (!result.ok) {
        setLookupError(result.error)
        return
      }
      setMatches(result.matches)
      setPicked(0)
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
  return (
    <div className="address-lookup">
      <div className="inline-form">
        <div className="field field-wide">
          <label htmlFor={`${id}-text`}>Address</label>
          <input
            id={`${id}-text`}
            type="text"
            maxLength={300}
            placeholder="15400 Knoll Trail Dr, Dallas, TX"
            autoFocus
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setMatches(null)
              setLookupError(null)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (text.trim() && !looking) find()
            }}
          />
        </div>
        <div className="field-edit-buttons">
          <button type="button" className="btn btn-primary btn-small" disabled={looking || pending || text.trim().length === 0} onClick={find}>{looking ? 'Looking…' : 'Find Address'}</button>
          <button type="button" className="btn btn-ghost btn-small" disabled={looking || pending} onClick={reset}>Cancel</button>
        </div>
      </div>
      <p className="note address-note">
        Type the street address with its city and state, then Find Address. United States addresses only;{' '}
        <button type="button" className="link-button" onClick={() => setByHand(true)}>Enter It by Hand</button> for anything else.
      </p>
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
          <input type="hidden" name="latitude" value={match.latitude} />
          <input type="hidden" name="longitude" value={match.longitude} />
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
          <p className="doc-sub">
            Map location: {match.latitude.toFixed(5)}, {match.longitude.toFixed(5)} ·{' '}
            <a href={mapLink(match.latitude, match.longitude)} target="_blank" rel="noreferrer">Check on a Map</a>
          </p>
          <div className="inline-form">
            <div className="field field-narrow">
              <label htmlFor={`${id}-suite`}>Suite (Optional)</label>
              <input id={`${id}-suite`} name="suite" type="text" maxLength={200} value={suite} onChange={(event) => setSuite(event.target.value)} />
            </div>
            <div className="field-edit-buttons">
              <button type="submit" className="btn btn-primary btn-small" disabled={pending}>{pending ? 'Adding…' : 'Add This Address'}</button>
            </div>
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
