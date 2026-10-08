'use client'

import { useActionState, useEffect } from 'react'
import { useClerk } from '@clerk/nextjs'
import { setupOrganization, type SetupOrganizationState } from './actions'

const initialState: SetupOrganizationState = { error: null, organizationId: null }

export function SetupOrganizationForm() {
  const [state, formAction, pending] = useActionState(setupOrganization, initialState)
  const { setActive } = useClerk()

  // Once the organization exists, make it the active one and open the app.
  useEffect(() => {
    if (!state.organizationId) return
    setActive({ organization: state.organizationId }).then(() => {
      // Open the new organization's Brand colors page so its colors can be checked.
      window.location.assign('/dashboard/settings?status=welcome')
    })
  }, [state.organizationId, setActive])

  const busy = pending || Boolean(state.organizationId)

  return (
    <form action={formAction} className="stack">
      <div className="field">
        <label htmlFor="org-name">Organization name</label>
        <input id="org-name" name="name" type="text" required maxLength={100} autoComplete="organization" placeholder="Your company name" />
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Setting up and picking your brand colors…' : 'Set Up Organization'}
      </button>
      {busy ? <p className="note">This can take up to half a minute.</p> : null}
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    </form>
  )
}
