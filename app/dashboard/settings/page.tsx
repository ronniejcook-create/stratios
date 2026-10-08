import { auth, clerkClient } from '@clerk/nextjs/server'
import { DEFAULT_THEME, THEME_ROLES, parseTheme } from '@/lib/theme'
import { regenerateColours, resetColours, saveColours } from './actions'
import { SubmitButton } from './SubmitButton'

export const dynamic = 'force-dynamic'

const MESSAGES: Record<string, { text: string; error?: boolean }> = {
  saved: { text: 'Colours saved.' },
  'saved-adjusted': { text: 'Colours saved. Some text colours were adjusted so they stay readable.' },
  regenerated: { text: 'New colours picked from your website.' },
  reset: { text: 'Back to the Stratios colours.' },
  'no-domain': { text: 'This organization has no company domain to look up, so colours have to be set by hand.', error: true },
  'no-key': { text: 'Automatic colours need an Anthropic API key in the settings file (ANTHROPIC_API_KEY).', error: true },
  'generate-failed': { text: 'Colours could not be worked out from your website. Try again, or set them by hand.', error: true },
  invalid: { text: 'Every colour needs to be a valid colour.', error: true },
  'not-admin': { text: 'Only administrators can change the colours.', error: true },
  failed: { text: 'That change could not be saved. Try again.', error: true },
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { orgId, orgRole } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  const isAdmin = orgRole === 'org:admin'
  const { status } = await searchParams
  const message = status ? MESSAGES[status] : undefined

  const client = await clerkClient()
  const organization = await client.organizations.getOrganization({ organizationId: orgId })
  const stored = parseTheme(organization.publicMetadata?.theme)
  const theme = stored ?? DEFAULT_THEME
  const domain = typeof organization.publicMetadata?.domain === 'string' ? organization.publicMetadata.domain : null

  return (
    <>
      <h1>Brand colours</h1>
      <p className="lede">
        {stored ? `${organization.name} uses its own colour scheme in Stratios.` : `${organization.name} uses the Stratios colours.`}
        {domain ? ` Automatic colours are based on ${domain}.` : ''}
      </p>

      {message ? (
        <p className={message.error ? 'form-error' : 'form-ok'} role={message.error ? 'alert' : 'status'}>{message.text}</p>
      ) : null}

      <section className="panel">
        <h2>Colours</h2>
        <form action={saveColours}>
          <fieldset disabled={!isAdmin} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="swatches">
              {THEME_ROLES.map((role) => (
                <div key={role.key} className="swatch">
                  <input id={`colour-${role.key}`} name={role.key} type="color" defaultValue={theme[role.key]} />
                  <label htmlFor={`colour-${role.key}`}>
                    {role.label}
                    <span className="hex">{theme[role.key]}</span>
                  </label>
                </div>
              ))}
            </div>
            {isAdmin ? (
              <div className="button-row">
                <SubmitButton className="btn btn-primary btn-small" pendingText="Saving…">Save colours</SubmitButton>
              </div>
            ) : (
              <p className="note">Only administrators can change the colours.</p>
            )}
          </fieldset>
        </form>
      </section>

      {isAdmin ? (
        <section className="panel">
          <h2>Start again</h2>
          <div className="button-row">
            {domain ? (
              <form action={regenerateColours}>
                <SubmitButton className="btn btn-ghost btn-small" pendingText="Looking at your website…">
                  {`Pick colours from ${domain}`}
                </SubmitButton>
              </form>
            ) : null}
            <form action={resetColours}>
              <SubmitButton className="btn btn-ghost btn-small" pendingText="Resetting…">Use Stratios colours</SubmitButton>
            </form>
          </div>
          <p className="note">Picking colours from your website takes up to half a minute.</p>
        </section>
      ) : null}
    </>
  )
}
