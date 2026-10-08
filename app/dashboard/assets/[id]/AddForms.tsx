'use client'

import { useActionState, useEffect, useState } from 'react'
import { addAddress, addChild, type AddState } from './actions'

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

/** A small "Add Address" button that opens an address form for a property, building or unit. */
export function AddAddressForm({ ownerType, ownerId, assetId }: { ownerType: 'property' | 'building' | 'unit'; ownerId: string; assetId: string }) {
  const [state, formAction, pending] = useActionState(addAddress, initialState)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (state.done > 0) setOpen(false)
  }, [state.done])

  const id = `address-${ownerId}`
  if (!open) {
    return (
      <button type="button" className="link-button add-link" onClick={() => setOpen(true)}>
        + Add Address
      </button>
    )
  }
  return (
    <form action={formAction} className="inline-form">
      <input type="hidden" name="ownerType" value={ownerType} />
      <input type="hidden" name="ownerId" value={ownerId} />
      <input type="hidden" name="assetId" value={assetId} />
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
        <button type="button" className="btn btn-ghost btn-small" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    </form>
  )
}
