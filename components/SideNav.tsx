'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'

const icon = (path: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
)

const SECTIONS: { title: string; adminOnly?: boolean; items: { label: string; href: string; icon: ReactNode }[] }[] = [
  {
    title: 'Portfolio',
    items: [
      { label: 'Assets', href: '/dashboard', icon: icon(<><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-6h6v6" /></>) },
    ],
  },
  {
    title: 'Administration',
    adminOnly: true,
    items: [
      { label: 'Members', href: '/dashboard/members', icon: icon(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.6 2.5 3 5.2" /></>) },
      { label: 'Brand colors', href: '/dashboard/settings', icon: icon(<><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7.5" r="1" /><circle cx="15" cy="8" r="1" /></>) },
    ],
  },
]

/** The left-hand navigation, with a filter box. Administration is shown to administrators only. */
export function SideNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const [filter, setFilter] = useState('')
  const term = filter.trim().toLowerCase()

  const sections = SECTIONS.filter((section) => isAdmin || !section.adminOnly).map((section) => ({
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
              const active = pathname === item.href
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
