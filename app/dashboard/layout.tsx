import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { AccountMenu } from '@/components/AccountMenu'
import { Logo } from '@/components/Logo'
import { OrgMenu } from '@/components/OrgMenu'
import { DEFAULT_THEME, parseTheme, themeToStyle } from '@/lib/theme'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, userId, orgId, redirectToSignIn } = await auth()
  if (!isAuthenticated || !userId) return redirectToSignIn()
  // Everything in the app belongs to an organization, so one must be active.
  if (!orgId) redirect('/onboarding')

  const client = await clerkClient()
  const memberships = await client.users.getOrganizationMembershipList({ userId, limit: 100 })
  const organizations = memberships.data.map((m) => ({ id: m.organization.id, name: m.organization.name }))
  const current = organizations.find((org) => org.id === orgId) ?? { id: orgId, name: 'Organization' }
  const activeOrganization = memberships.data.find((m) => m.organization.id === orgId)?.organization
  const theme = parseTheme(activeOrganization?.publicMetadata?.theme) ?? DEFAULT_THEME

  return (
    <div className="org-theme" style={themeToStyle(theme)}>
      <header className="site-header app-header">
        <div className="wrap">
          <Link href="/dashboard" className="brand">
            <Logo />
            <span>Stratios</span>
          </Link>
          <div className="app-tools">
            <Link href="/dashboard" className="nav-link">Assets</Link>
            <Link href="/dashboard/members" className="nav-link">Members</Link>
            <OrgMenu current={current} organizations={organizations} />
            <AccountMenu />
          </div>
        </div>
      </header>
      <main className="wrap app-main">{children}</main>
    </div>
  )
}
