import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

// One font for everything: Inter. Headings and buttons read it through --font-display,
// which globals.css points at --font-body.
const body = Inter({ subsets: ['latin'], variable: '--font-body' })

// Makes Clerk's sign-in, organization and account components use the
// Stratios colors and fonts (see globals.css for the same palette).
const clerkAppearance = {
  variables: {
    colorPrimary: '#2ccbe8',
    colorPrimaryForeground: '#06202b',
    colorBackground: '#14253c',
    colorForeground: '#e6edf7',
    colorMuted: '#0f1d31',
    colorMutedForeground: '#b9c6d9',
    colorNeutral: '#ffffff',
    colorBorder: '#5b6c85',
    colorInput: '#0f1d31',
    colorInputForeground: '#ffffff',
    colorRing: '#2ccbe8',
    colorDanger: '#ff9d8a',
    borderRadius: '4px',
    fontFamily: 'var(--font-body), system-ui, sans-serif',
    fontFamilyButtons: 'var(--font-display), sans-serif',
    fontSize: '0.9375rem',
  },
}

export const metadata: Metadata = {
  // dev.stratios.app is a test site: ask search engines not to list it.
  // Remove this line (and the header in next.config.ts) when the public site launches.
  robots: { index: false, follow: false },
  title: 'Stratios | Commercial real estate intelligence',
  description:
    'Structure your CRE assets, turn financial documents into reviewable data, and interrogate performance with an AI analyst.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={body.variable}>
      <body>
        <ClerkProvider appearance={clerkAppearance}>{children}</ClerkProvider>
      </body>
    </html>
  )
}
