'use client'

import { useActionState } from 'react'
import { addAsset, type AddAssetState } from './actions'

const initialState: AddAssetState = { error: null }

export function AddAssetForm({ propertyTypes, onCancel }: { propertyTypes: readonly string[]; onCancel?: () => void }) {
  const [state, formAction, pending] = useActionState(addAsset, initialState)

  return (
    <form action={formAction}>
      <div className="form-row">
        <div className="field">
          <label htmlFor="asset-name">Name</label>
          <input id="asset-name" name="name" type="text" required maxLength={200} placeholder="Asset name" />
        </div>
        <div className="field">
          <label htmlFor="asset-type">Property Type</label>
          <select id="asset-type" name="propertyType" defaultValue={propertyTypes[0]}>
            {propertyTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="asset-city">City</label>
          <input id="asset-city" name="city" type="text" maxLength={200} placeholder="Optional" />
        </div>
      </div>
      <p className="note">An asset starts with one property and one building. Its page opens once it is added, where you can add more.</p>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <div className="button-row modal-actions">
        {onCancel ? <button type="button" className="btn btn-ghost btn-small" disabled={pending} onClick={onCancel}>Cancel</button> : null}
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>
          {pending ? 'Adding…' : 'Add Asset'}
        </button>
      </div>
    </form>
  )
}
