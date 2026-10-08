'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { Menu } from './Menu'

type Org = { id: string; name: string }

/** Shows the active organization and lets people who belong to several switch. */
export function OrgMenu({ current, organizations }: { current: Org; organizations: Org[] }) {
  const { setActive } = useClerk()
  const [switching, setSwitching] = useState(false)
  const others = organizations.filter((org) => org.id !== current.id)

  async function switchTo(id: string) {
    setSwitching(true)
    try {
      await setActive({ organization: id })
      window.location.assign('/dashboard')
    } catch {
      setSwitching(false)
    }
  }

  return (
    <Menu
      label={`Organization: ${current.name}`}
      trigger={
        <>
          <span className="org-name">{switching ? 'Switching…' : current.name}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M2.5 4.5L6 8l3.5-3.5" />
          </svg>
        </>
      }
    >
      <div className="menu-heading">Organization</div>
      <div className="menu-current">{current.name}</div>
      <Link href="/dashboard/members" className="menu-item">Members and invitations</Link>
      <Link href="/dashboard/settings" className="menu-item">Brand colors</Link>
      {others.length > 0 ? (
        <>
          <div className="menu-heading menu-divider">Switch to</div>
          {others.map((org) => (
            <button key={org.id} type="button" className="menu-item" onClick={() => switchTo(org.id)}>
              {org.name}
            </button>
          ))}
        </>
      ) : null}
    </Menu>
  )
}
