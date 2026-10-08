'use client'

import { useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { Menu } from './Menu'

type Org = { id: string; name: string }

/**
 * "for <organization>" in the header. For people in more than one
 * organization it opens a list to switch between them; otherwise it is plain text.
 */
export function OrgMenu({ current, organizations }: { current: Org; organizations: Org[] }) {
  const { setActive } = useClerk()
  const [switching, setSwitching] = useState(false)
  const others = organizations.filter((org) => org.id !== current.id)

  if (others.length === 0) return <span className="brand-org">for {current.name}</span>

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
      label={`Organization: ${current.name}. Switch organization`}
      triggerClassName="org-switch"
      trigger={
        <>
          <span className="brand-org">{switching ? 'Switching…' : `for ${current.name}`}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M2.5 4.5L6 8l3.5-3.5" />
          </svg>
        </>
      }
    >
      <div className="menu-heading">Switch organization</div>
      <div className="menu-current">{current.name}</div>
      {others.map((org) => (
        <button key={org.id} type="button" className="menu-item" onClick={() => switchTo(org.id)}>
          {org.name}
        </button>
      ))}
    </Menu>
  )
}
