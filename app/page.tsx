import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SignInButton, SignUpButton } from '@clerk/nextjs'
import { auth } from '@clerk/nextjs/server'
import { Logo } from '@/components/Logo'

export default async function LandingPage() {
  // People who are already signed in skip the landing page.
  const { userId } = await auth()
  if (userId) redirect('/dashboard')

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <Link href="/" className="brand">
            <Logo />
            <span>Stratios</span>
          </Link>
          <nav className="nav" aria-label="Main">
            <a href="#product" className="nav-link">Product</a>
            <a href="#how" className="nav-link">How it works</a>
            <SignInButton mode="modal" fallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard">
              <button type="button" className="btn btn-ghost btn-small">Sign in</button>
            </SignInButton>
          </nav>
        </div>
      </header>

      <main>
        <section className="wrap hero">
          <div className="eyebrow">Commercial Real Estate / Intelligence</div>
          <h1>
            Your portfolio.
            <br />
            One source of intelligence.
          </h1>
          <p>
            Structure your CRE assets, turn financial documents into reviewable data, and interrogate
            performance with an AI analyst.
          </p>
          <div className="actions">
            <SignUpButton mode="modal" fallbackRedirectUrl="/dashboard" signInFallbackRedirectUrl="/dashboard">
              <button type="button" className="btn btn-primary">Sign up</button>
            </SignUpButton>
            <a href="#how" className="btn btn-ghost">See how it works</a>
          </div>
        </section>

        <section id="product" className="section">
          <div className="wrap">
            <div className="eyebrow">Product</div>
            <h2>Three jobs, one place to do them.</h2>
            <div className="row">
              <article className="card">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
                  <rect x="11" y="3" width="10" height="7" />
                  <rect x="2" y="22" width="9" height="7" />
                  <rect x="21" y="22" width="9" height="7" />
                  <path d="M16 10v6M6.5 22v-6h19v6" />
                </svg>
                <h3>Structure Your Assets</h3>
                <p>
                  Organize funds, properties and tenancies into one hierarchy, so every figure has a clear
                  place in the portfolio.
                </p>
              </article>
              <article className="card">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
                  <path d="M7 3h12l6 6v20H7z" />
                  <path d="M19 3v6h6M11 15h10M11 19h10M11 23h6" />
                </svg>
                <h3>Documents Into Reviewable Data</h3>
                <p>
                  Upload rent rolls, operating statements and budgets. Stratios extracts the numbers and
                  puts them in front of you to check before anything is saved.
                </p>
              </article>
              <article className="card">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 5h24v17H14l-6 5v-5H4z" />
                  <path d="M10 17l4-5 4 3 4-5" />
                </svg>
                <h3>Interrogate Performance</h3>
                <p>
                  Ask the AI analyst questions in plain language and get answers drawn from your own
                  reviewed portfolio data.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section id="how" className="section">
          <div className="wrap">
            <div className="eyebrow">How it works</div>
            <h2>From a folder of PDFs to answers.</h2>
            <ol className="row">
              <li className="step">
                <div className="step-num">01</div>
                <h3>Set Up Your Portfolio</h3>
                <p>Add your properties and arrange them the way you already report on them.</p>
              </li>
              <li className="step">
                <div className="step-num">02</div>
                <h3>Upload and Review</h3>
                <p>Drop in financial documents. Check the extracted data against the source, correct it, and approve.</p>
              </li>
              <li className="step">
                <div className="step-num">03</div>
                <h3>Ask the Analyst</h3>
                <p>Question performance across an asset or the whole portfolio, without building another spreadsheet.</p>
              </li>
            </ol>
          </div>
        </section>

        <section id="signup" className="section signup">
          <div className="wrap">
            <div className="signup-copy">
              <div className="eyebrow">Get started</div>
              <h2>Sign up for Stratios.</h2>
              <p>
                Create an account and set up your organization. Everyone you invite sees the same
                portfolio; nobody outside your organization does.
              </p>
            </div>
            <div className="signup-panel">
              <h3>New to Stratios?</h3>
              <p>Create your account, name your organization, then invite your colleagues by email.</p>
              <SignUpButton mode="modal" fallbackRedirectUrl="/dashboard" signInFallbackRedirectUrl="/dashboard">
                <button type="button" className="btn btn-primary">Create your organization</button>
              </SignUpButton>
              <p className="fine">
                Joining a colleague&apos;s organization? Use the link in your invitation email. Already
                have an account?{' '}
                <SignInButton mode="modal" fallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard">
                  <button type="button" className="text-link">Sign in</button>
                </SignInButton>
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap">
          <div>© 2026 Stratios</div>
        </div>
      </footer>
    </>
  )
}
