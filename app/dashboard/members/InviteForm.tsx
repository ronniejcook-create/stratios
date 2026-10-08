'use client'

import { useActionState } from 'react'
import { inviteMember, type InviteState } from './actions'

const initialState: InviteState = { error: null, sentTo: null }

export function InviteForm() {
  const [state, formAction, pending] = useActionState(inviteMember, initialState)

  return (
    <form action={formAction}>
      <div className="form-row">
        <div className="field">
          <label htmlFor="invite-email">Email address</label>
          <input id="invite-email" name="email" type="email" required placeholder="colleague@company.com" />
        </div>
        <div className="field">
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" name="role" defaultValue="org:member">
            <option value="org:member">Member</option>
            <option value="org:admin">Administrator</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>
          {pending ? 'Sending…' : 'Send Invitation'}
        </button>
      </div>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.sentTo ? <p className="form-ok" role="status">Invitation sent to {state.sentTo}.</p> : null}
    </form>
  )
}
