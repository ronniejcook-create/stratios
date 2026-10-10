'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { useEffect, useState, type ReactNode } from 'react'

const icon = (path: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
)

const SECTIONS: { title: string; adminOnly?: boolean; stratiosOnly?: boolean; items: { label: string; href: string; icon: ReactNode }[] }[] = [
  {
    title: 'Investment Management',
    items: [
      { label: 'Assets', href: '/dashboard', icon: icon(<><path d="M4 20V6l7-2v16" /><path d="M11 9h9v11" /><path d="M7 9h1M7 13h1M15 13h1M15 17h1" /><path d="M2.5 20h19" /></>) },
      { label: 'Tenants', href: '/dashboard/tenants', icon: icon(<><circle cx="8" cy="15.5" r="4.5" /><path d="M11.2 12.3L20 3.5" /><path d="M16.5 7l3 3M13.5 10l2.2 2.2" /></>) },
    ],
  },
  {
    title: 'Admin Settings',
    adminOnly: true,
    items: [
      { label: 'Users', href: '/dashboard/members', icon: icon(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.6 2.5 3 5.2" /></>) },
      { label: 'Roles and Permissions', href: '/dashboard/roles', icon: icon(<><path d="M12 3l7 3v5.5c0 4.3-2.9 7.6-7 9.5-4.1-1.9-7-5.2-7-9.5V6l7-3z" /><path d="M9 12l2.2 2.2L15.5 10" /></>) },
      { label: 'Fields Library', href: '/dashboard/fields', icon: icon(<><rect x="3.5" y="4.5" width="17" height="6" rx="1.5" /><rect x="3.5" y="13.5" width="17" height="6" rx="1.5" /><path d="M7 7.5h4M7 16.5h6" /></>) },
      { label: 'Layouts', href: '/dashboard/layouts', icon: icon(<><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M3.5 9.5h17M9 9.5V20" /></>) },
      { label: 'Skills Library', href: '/dashboard/skills', icon: icon(<><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" /><path d="M5 17a3 3 0 0 1 3-3h11" /><path d="M9 8h6" /></>) },
      { label: 'Org Colors', href: '/dashboard/settings', icon: icon(<><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7.5" r="1" /><circle cx="15" cy="8" r="1" /></>) },
    ],
  },
  {
    title: 'Stratios Admin',
    stratiosOnly: true,
    items: [
      { label: 'Analyst Instructions', href: '/dashboard/analyst', icon: icon(<><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>) },
      { label: 'Fields Library', href: '/dashboard/library', icon: icon(<><rect x="3.5" y="4.5" width="17" height="6" rx="1.5" /><rect x="3.5" y="13.5" width="17" height="6" rx="1.5" /><path d="M7 7.5h4M7 16.5h6" /></>) },
      { label: 'Layouts', href: '/dashboard/layout-library', icon: icon(<><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M3.5 9.5h17M9 9.5V20" /></>) },
      { label: 'Skills Library', href: '/dashboard/skill-library', icon: icon(<><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" /><path d="M5 17a3 3 0 0 1 3-3h11" /><path d="M9 8h6" /></>) },
    ],
  },
]

/**
 * The left-hand navigation, with a filter box. Admin Settings is shown to
 * administrators only, and Stratios Admin only to administrators of the
 * Stratios organization.
 */
export function SideNav({ isAdmin, isStratiosAdmin = false }: { isAdmin: boolean; isStratiosAdmin?: boolean }) {
  const pathname = usePathname()
  const { user } = useUser()
  const [filter, setFilter] = useState('')
  // The groups the person has closed, by title. Kept in this browser for an instant start and on
  // their account so it follows them to another computer (like the agent column's width).
  const [closed, setClosed] = useState<string[]>([])
  const closedKey = user ? `stratios.navClosed.${user.id}` : null
  const onAccount = user?.unsafeMetadata?.navClosed
  useEffect(() => {
    if (!closedKey) return
    let saved: unknown = null
    try {
      saved = JSON.parse(window.localStorage.getItem(closedKey) ?? 'null')
    } catch {
      saved = null
    }
    const wanted = Array.isArray(saved) ? saved : Array.isArray(onAccount) ? onAccount : []
    setClosed(wanted.map(String))
    // Read once per person; later changes come from the clicks below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedKey])
  const toggle = (title: string) => {
    const next = closed.includes(title) ? closed.filter((item) => item !== title) : [...closed, title]
    setClosed(next)
    try {
      if (closedKey) window.localStorage.setItem(closedKey, JSON.stringify(next))
    } catch {
      // A private window may refuse; the account copy below still remembers it.
    }
    user?.update({ unsafeMetadata: { ...user.unsafeMetadata, navClosed: next } }).catch((error) => console.error('Saving the navigation groups failed', error))
  }
  const term = filter.trim().toLowerCase()

  const sections = SECTIONS.filter((section) => (isAdmin || !section.adminOnly) && (isStratiosAdmin || !section.stratiosOnly)).map((section) => ({
    ...section,
    // The two admin groups are kept in alphabetical order, so a new item needs no placing by hand.
    items: (section.adminOnly || section.stratiosOnly ? [...section.items].sort((a, b) => a.label.localeCompare(b.label)) : section.items)
      .filter((item) => !term || item.label.toLowerCase().includes(term)),
  })).filter((section) => section.items.length > 0)

  return (
    <nav className="side-nav">
      <div className="side-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M20 20l-4.2-4.2" />
        </svg>
        <input type="search" placeholder="Search…" aria-label="Search navigation" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {sections.map((section) => {
        // A search opens every group that has a match, without changing what is remembered.
        const open = term !== '' || !closed.includes(section.title)
        return (
        <div key={section.title} className="side-section">
          <button type="button" className="side-title" aria-expanded={open} title={open ? 'Collapse' : 'Expand'} onClick={() => toggle(section.title)}>
            <span>{section.title}</span>
            <svg className={`side-chevron${open ? ' open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          {open ? (
          <ul>
            {section.items.map((item) => {
              // An asset's own page still counts as being in Assets.
              const active =
                pathname === item.href ||
                (item.href === '/dashboard' ? pathname.startsWith('/dashboard/assets/') : pathname.startsWith(`${item.href}/`))
              return (
                <li key={item.href}>
                  <Link href={item.href} className={`side-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
                    {item.icon}
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
          ) : null}
        </div>
        )
      })}
      {sections.length === 0 ? <p className="side-empty">Nothing matches “{filter}”.</p> : null}
    </nav>
  )
}
