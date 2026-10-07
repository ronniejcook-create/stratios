'use client'

import { useActionState } from 'react'
import { addAsset, type AddAssetState } from './actions'

const initialState: AddAssetState = { error: null }

export function AddAssetForm({ assetTypes }: { assetTypes: readonly string[] }) {
  const [state, formAction, pending] = useActionState(addAsset, initialState)

  return (
    <form action={formAction}>
      <div className="form-row">
        <div className="field">
          <label htmlFor="asset-name">Name</label>
          <input id="asset-name" name="name" type="text" required maxLength={200} placeholder="Property name" />
        </div>
        <div className="field">
          <label htmlFor="asset-type">Type</label>
          <select id="asset-type" name="assetType" defaultValue={assetTypes[0]}>
            {assetTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="asset-city">City</label>
          <input id="asset-city" name="city" type="text" maxLength={200} placeholder="Optional" />
        </div>
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>
          {pending ? 'Adding…' : 'Add asset'}
        </button>
      </div>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    </form>
  )
}
