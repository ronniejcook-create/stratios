import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { AccountMenu } from '@/components/AccountMenu'
import { Logo } from '@/components/Logo'
import { OrgMenu } from '@/components/OrgMenu'
import { DEFAULT_THEME, parseBrandSettings, parseTheme, themeToStyle } from '@/lib/theme'
import { displayChartColors, parseChartColors } from '@/lib/chartColors'
import { getOrgSettings } from '@/lib/orgSettings'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, userId, orgId, redirectToSignIn } = await auth()
  if (!isAuthenticated || !userId) return redirectToSignIn()
  // Everything in the app belongs to an organization, so one must be active.
  if (!orgId) redirect('/onboarding')

  const client = await clerkClient()
  const [memberships, activeOrganization] = await Promise.all([
    client.users.getOrganizationMembershipList({ userId, limit: 100 }),
    client.organizations.getOrganization({ organizationId: orgId }),
  ])
  const organizations = memberships.data.map((m) => ({ id: m.organization.id, name: m.organization.name }))
  const settings = await getOrgSettings(orgId)
  const theme = parseTheme(settings.theme) ?? DEFAULT_THEME
  const { brand, mode } = parseBrandSettings(settings.theme)
  const chartColors = displayChartColors(parseChartColors(settings.chartColors), theme, brand, mode)
  // Graph colors are available to every chart as --chart-1 … --chart-8.
  const style = { ...themeToStyle(theme), ...Object.fromEntries(chartColors.map((c, i) => [`--chart-${i + 1}`, c])) }
  const current = { id: activeOrganization.id, name: activeOrganization.name }

  return (
    <div className="org-theme" style={style}>
      <header className="site-header app-header">
        <div className="wrap">
          <Link href="/dashboard" className="brand">
            <Logo />
            <span>Stratios</span>
            <span className="brand-org">for {current.name}</span>
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
