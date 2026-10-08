import Link from 'next/link'
import { AccountMenu } from '@/components/AccountMenu'
import { Logo } from '@/components/Logo'
import { ChooseOrganization } from './ChooseOrganization'

// Shown when a signed-in person has memberships or invitations but no active
// organization: accept an invitation or pick an organization to open.
export default function SelectOrganizationPage() {
  return (
    <>
      <header className="site-header app-header">
        <div className="wrap">
          <Link href="/" className="brand">
            <Logo />
            <span>Stratios</span>
          </Link>
          <AccountMenu />
        </div>
      </header>
      <main className="onboarding">
        <section className="panel">
          <ChooseOrganization />
        </section>
      </main>
    </>
  )
}
