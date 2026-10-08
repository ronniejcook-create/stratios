import Link from 'next/link'
import type { ReactNode } from 'react'
import { Logo } from '@/components/Logo'

// Stratios branding around the Clerk sign-in / sign-up forms, used when someone
// lands on /sign-in or /sign-up directly (invitation emails, bookmarks, links).
export function AuthFrame({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <Link href="/" className="brand">
            <Logo />
            <span>Stratios</span>
          </Link>
          <nav className="nav" aria-label="Main">
            <Link href="/" className="nav-link">Back to home</Link>
          </nav>
        </div>
      </header>
      <main className="auth-page">
        <div className="auth-intro">
          <div className="eyebrow">Commercial Real Estate / Intelligence</div>
          <h1>{title}</h1>
          <p>{text}</p>
        </div>
        <div className="auth-form">{children}</div>
      </main>
    </>
  )
}
