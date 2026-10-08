'use client'

import { useActionState } from 'react'
import { addRole, type RoleFormState } from './actions'

const initialState: RoleFormState = { error: null, message: null, done: 0 }

export function AddRoleForm() {
  const [state, formAction, pending] = useActionState(addRole, initialState)
  return (
    <form action={formAction}>
      <div className="form-row">
        <div className="field">
          <label htmlFor="new-role-name">Role Name</label>
          <input id="new-role-name" name="name" type="text" required maxLength={60} placeholder="Asset Manager" />
        </div>
        <div className="field">
          <label htmlFor="new-role-level">Default Access</label>
          <select id="new-role-level" name="defaultLevel" defaultValue="edit">
            <option value="edit">Edit: See and Change Fields</option>
            <option value="view">View: See Fields Only</option>
            <option value="hidden">Hidden: See Nothing Unless Allowed</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>{pending ? 'Adding…' : 'Add Role'}</button>
      </div>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.message ? <p className="form-ok" role="status">{state.message}</p> : null}
    </form>
  )
}
