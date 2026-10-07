import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { OrganizationSwitcher, UserButton } from '@clerk/nextjs'
import { Logo } from '@/components/Logo'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, orgId, redirectToSignIn } = await auth()
  if (!isAuthenticated) return redirectToSignIn()
  // Everything in the app belongs to an organization, so one must be active.
  if (!orgId) redirect('/select-organization')

  return (
    <>
      <header className="site-header app-header">
        <div className="wrap">
          <Link href="/dashboard" className="brand">
            <Logo />
            <span>Stratios</span>
          </Link>
          <div className="app-tools">
            <Link href="/dashboard" className="nav-link">Assets</Link>
            <Link href="/dashboard/members" className="nav-link">Members</Link>
            <OrganizationSwitcher
              hidePersonal
              afterSelectOrganizationUrl="/dashboard"
              afterCreateOrganizationUrl="/dashboard"
            />
            <UserButton />
          </div>
        </div>
      </header>
      <main className="wrap app-main">{children}</main>
    </>
  )
}
