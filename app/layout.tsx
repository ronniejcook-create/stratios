import type { Metadata } from 'next'
import { IBM_Plex_Sans, Space_Grotesk } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display' })
const body = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body' })

export const metadata: Metadata = {
  title: 'Stratios | Commercial real estate intelligence',
  description:
    'Structure your CRE assets, turn financial documents into reviewable data, and interrogate performance with an AI analyst.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  )
}
