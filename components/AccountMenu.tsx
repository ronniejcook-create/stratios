'use client'

import { useClerk, useUser } from '@clerk/nextjs'
import { Menu } from './Menu'

function initialsFor(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return email.slice(0, 2).toUpperCase() || '?'
}

/** The signed-in person's menu: who they are, account settings, sign out. */
export function AccountMenu() {
  const { user, isLoaded } = useUser()
  const clerk = useClerk()

  const name = user?.fullName ?? ''
  const email = user?.primaryEmailAddress?.emailAddress ?? ''

  return (
    <Menu
      label="Account menu"
      triggerClassName="avatar-trigger"
      trigger={<span className="avatar">{isLoaded ? initialsFor(name, email) : ''}</span>}
    >
      <div className="menu-identity">
        {name ? <div className="menu-current">{name}</div> : null}
        <div className="menu-sub">{email}</div>
      </div>
      <button type="button" className="menu-item menu-divider" onClick={() => clerk.openUserProfile()}>
        Account settings
      </button>
      <button type="button" className="menu-item" onClick={() => clerk.signOut({ redirectUrl: '/' })}>
        Sign out
      </button>
    </Menu>
  )
}
