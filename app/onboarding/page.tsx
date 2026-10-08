import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { AccountMenu } from '@/components/AccountMenu'
import { Logo } from '@/components/Logo'
import { getOnboardingState } from '@/lib/organizations'
import { SetupOrganizationForm } from './SetupOrganizationForm'

export const dynamic = 'force-dynamic'

// First stop after sign-up. Looks at the domain of the person's email address:
// a new domain is prompted to set up its organization; a domain that already
// has one is told to ask for an invitation.
export default async function OnboardingPage() {
  const { isAuthenticated, userId, orgId, redirectToSignIn } = await auth()
  if (!isAuthenticated || !userId) return redirectToSignIn()
  if (orgId) redirect('/dashboard')

  const state = await getOnboardingState(userId)
  if (state.kind === 'has-organizations') redirect('/select-organization')

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
        {state.kind === 'unverified-email' ? (
          <section className="panel">
            <h1>Verify your email</h1>
            <p>Your email address needs to be verified before you can continue. Check your inbox, then refresh this page.</p>
          </section>
        ) : state.kind === 'domain-taken' ? (
          <section className="panel">
            <div className="eyebrow">Already on Stratios</div>
            <h1>{state.organizationName} already has an organization</h1>
            <p>
              Your email address, {state.email}, belongs to <strong>{state.domain}</strong>, which is already set up.
              Ask an administrator at {state.organizationName} to invite you. Once they have, come back and you
              will be able to join.
            </p>
            <a href="/onboarding" className="btn btn-ghost">Check for my invitation</a>
          </section>
        ) : (
          <section className="panel">
            <div className="eyebrow">Welcome</div>
            <h1>Set up your organization</h1>
            {state.domain ? (
              <p>
                You are the first person from <strong>{state.domain}</strong>. Name your organization and you will
                become its administrator. Colleagues who sign up with an @{state.domain} address will be pointed
                to you for an invitation.
              </p>
            ) : (
              <p>
                Name your organization and you will become its administrator. Because {state.email} is a personal
                email address, colleagues will need an invitation from you to join.
              </p>
            )}
            <SetupOrganizationForm />
          </section>
        )}
      </main>
    </>
  )
}
