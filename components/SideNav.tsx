'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'

const icon = (path: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
)

const SECTIONS: { title: string; adminOnly?: boolean; stratiosOnly?: boolean; items: { label: string; href: string; icon: ReactNode }[] }[] = [
  {
    title: 'Portfolio',
    items: [
      { label: 'Assets', href: '/dashboard', icon: icon(<><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-6h6v6" /></>) },
    ],
  },
  {
    title: 'Admin Settings',
    adminOnly: true,
    items: [
      { label: 'Members', href: '/dashboard/members', icon: icon(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.6 2.5 3 5.2" /></>) },
      { label: 'Roles and Permissions', href: '/dashboard/roles', icon: icon(<><path d="M12 3l7 3v5.5c0 4.3-2.9 7.6-7 9.5-4.1-1.9-7-5.2-7-9.5V6l7-3z" /><path d="M9 12l2.2 2.2L15.5 10" /></>) },
      { label: 'Fields and Layout', href: '/dashboard/fields', icon: icon(<><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M3.5 9.5h17M9 9.5V20" /></>) },
      { label: 'Org Colors', href: '/dashboard/settings', icon: icon(<><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7.5" r="1" /><circle cx="15" cy="8" r="1" /></>) },
    ],
  },
  {
    title: 'Stratios Admin',
    stratiosOnly: true,
    items: [
      { label: 'Analyst Instructions', href: '/dashboard/analyst', icon: icon(<><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>) },
      { label: 'Skills Library', href: '/dashboard/skills', icon: icon(<><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" /><path d="M5 17a3 3 0 0 1 3-3h11" /><path d="M9 8h6" /></>) },
      { label: 'Master Library', href: '/dashboard/library', icon: icon(<><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10v16H5.5A1.5 1.5 0 0 1 4 18.5v-13z" /><path d="M10 4h4v16h-4z" /><path d="M14.6 6.2l3.6-1 3.3 12.6-3.6 1z" /></>) },
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
  const [filter, setFilter] = useState('')
  const term = filter.trim().toLowerCase()

  const sections = SECTIONS.filter((section) => (isAdmin || !section.adminOnly) && (isStratiosAdmin || !section.stratiosOnly)).map((section) => ({
    ...section,
    items: section.items.filter((item) => !term || item.label.toLowerCase().includes(term)),
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
      {sections.map((section) => (
        <div key={section.title} className="side-section">
          <div className="side-title">{section.title}</div>
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
        </div>
      ))}
      {sections.length === 0 ? <p className="side-empty">Nothing matches “{filter}”.</p> : null}
    </nav>
  )
}
