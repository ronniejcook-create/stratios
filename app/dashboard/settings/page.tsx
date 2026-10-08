import { auth, clerkClient } from '@clerk/nextjs/server'
import { DEFAULT_THEME, THEME_ROLES, parseBrandSettings, parseTheme } from '@/lib/theme'
import { applyGraphPreset, applySitePreset, lookUpGraphColors, regenerateColors, resetColors, resetGraphColors, saveColors, saveGraphColors, setMode } from './actions'
import { GRAPH_PRESETS, SITE_PRESETS } from '@/lib/presets'
import { GraphColorsEditor } from './GraphColorsEditor'
import { displayChartColors, parseChartColors } from '@/lib/chartColors'
import { SwatchField } from './SwatchField'
import { SubmitButton } from './SubmitButton'

export const dynamic = 'force-dynamic'

const MESSAGES: Record<string, { text: string; error?: boolean }> = {
  welcome: { text: 'Your organization is set up. Check the colors below: you can switch to light mode, adjust any color, or use the Stratios colors.' },
  saved: { text: 'Colors saved.' },
  'saved-adjusted': { text: 'Colors saved. Some text colors were adjusted so they stay readable.' },
  regenerated: { text: 'New brand colors picked.' },
  reset: { text: 'Back to the Stratios colors.' },
  'graph-saved': { text: 'Graph colors saved.' },
  'site-preset': { text: 'Site color scheme applied.' },
  'graph-preset': { text: 'Graph palette applied.' },
  'graph-found': { text: 'Found graph colors this organization has used in the past.' },
  'graph-not-found': { text: 'No past graph colors were found for this organization, so graphs use muted colors built from its brand colors.' },
  'graph-reset': { text: 'Graphs now use muted colors built from your brand colors.' },
  'graph-invalid': { text: 'Every graph color needs to be a six-digit hex code, for example #1A1446.', error: true },
  'mode-dark': { text: 'Switched to dark mode.' },
  'mode-light': { text: 'Switched to light mode.' },
  'no-domain': { text: 'This organization has no company domain to look up, so colors have to be set by hand.', error: true },
  'no-key': { text: 'Automatic colors need an Anthropic API key in the settings file (ANTHROPIC_API_KEY).', error: true },
  'generate-failed': { text: 'Brand colors could not be worked out. Try again, or set them by hand.', error: true },
  invalid: { text: 'Every color needs to be a six-digit hex code, for example #1A1446.', error: true },
  'not-admin': { text: 'Only administrators can change the colors.', error: true },
  failed: { text: 'That change could not be saved. Try again.', error: true },
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ status?: string; detail?: string }> }) {
  const { orgId, orgRole } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  const isAdmin = orgRole === 'org:admin'
  const { status, detail } = await searchParams
  const message = status ? MESSAGES[status] : undefined

  const client = await clerkClient()
  const organization = await client.organizations.getOrganization({ organizationId: orgId })
  const stored = parseTheme(organization.publicMetadata?.theme)
  const theme = stored ?? DEFAULT_THEME
  const { mode, brand } = parseBrandSettings(organization.publicMetadata?.theme)
  const storedChart = parseChartColors(organization.publicMetadata?.chartColors)
  const chartColors = displayChartColors(storedChart, brand, mode, theme.surface)
  const chartSource =
    storedChart?.source === 'history' ? 'These are graph colors this organization has used in the past.' :
    storedChart?.source === 'manual' ? 'These graph colors were set by hand.' :
    storedChart?.source === 'preset' ? `These graph colors are the ${storedChart.name ?? 'chosen'} palette.` :
    'These are muted graph colors built from your brand colors.'
  const domain = typeof organization.publicMetadata?.domain === 'string' ? organization.publicMetadata.domain : null

  return (
    <>
      <h1>Brand colors</h1>
      <p className="lede">
        {stored ? `${organization.name} uses its own color scheme in Stratios.` : `${organization.name} uses the Stratios colors.`}
        {` Automatic colors come from ${organization.name}'s brand guidelines${domain ? `, or from ${domain} if those aren't known` : ''}.`}
      </p>

      {message ? (
        <div role={message.error ? 'alert' : 'status'}>
          <p className={message.error ? 'form-error' : 'form-ok'}>{message.text}</p>
          {detail ? <p className="note">{message.error ? `Reason: ${detail}` : detail}</p> : null}
        </div>
      ) : null}

      <section className="panel">
        <h2>Site Colors</h2>
        {isAdmin ? (
          <form action={setMode} className="mode-toggle" aria-label="Color mode">
            <button type="submit" name="mode" value="dark" aria-pressed={mode === 'dark'}>Dark</button>
            <button type="submit" name="mode" value="light" aria-pressed={mode === 'light'}>Light</button>
          </form>
        ) : (
          <p className="note">Mode: {mode === 'light' ? 'Light' : 'Dark'}</p>
        )}
        {isAdmin ? (
          <p className="note">Switching mode rebuilds all ten colors from your brand colors, replacing any changes made by hand.</p>
        ) : null}
        <form action={saveColors}>
          <fieldset disabled={!isAdmin} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="swatches">
              {THEME_ROLES.map((role) => (
                <SwatchField key={role.key} name={role.key} label={role.label} defaultValue={theme[role.key]} />
              ))}
            </div>
            {isAdmin ? (
              <div className="button-row">
                <SubmitButton className="btn btn-primary btn-small" pendingText="Saving…">Save colors</SubmitButton>
              </div>
            ) : (
              <p className="note">Only administrators can change the colors.</p>
            )}
          </fieldset>
        </form>
        {isAdmin ? (
          <div className="start-from">
            <h3>Start from</h3>
            <div className="button-row">
              <form action={regenerateColors}>
                <SubmitButton className="btn btn-ghost btn-small" pendingText="Looking up your brand colors…">Look up brand colors again</SubmitButton>
              </form>
              <form action={resetColors}>
                <SubmitButton className="btn btn-ghost btn-small" pendingText="Resetting…">Use Stratios colors</SubmitButton>
              </form>
            </div>
            <div className="preset-grid">
              {SITE_PRESETS.map((preset) => (
                <form key={preset.name} action={applySitePreset}>
                  <input type="hidden" name="preset" value={preset.name} />
                  <button type="submit" className="preset">
                    <span className="preset-dots" aria-hidden="true">
                      <span style={{ background: preset.primary }} />
                      <span style={{ background: preset.accent }} />
                    </span>
                    {preset.name}
                  </button>
                </form>
              ))}
            </div>
            <p className="note">Looking up brand colors takes up to half a minute: Stratios checks your organization&apos;s brand guidelines first and your website second. Every option rebuilds all ten colors in the current mode.</p>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>Graph Colors</h2>
        <p className="note">Used in order for charts and graphs: Color 1 for the first series, Color 2 for the second, and so on. {chartSource}</p>
        <GraphColorsEditor key={chartColors.join()} initial={chartColors} canEdit={isAdmin} action={saveGraphColors} />
        {isAdmin ? (
          <div className="button-row">
            <form action={lookUpGraphColors}>
              <SubmitButton className="btn btn-ghost btn-small" pendingText="Looking up past graphs…">Look up past graph colors</SubmitButton>
            </form>
            <form action={resetGraphColors}>
              <SubmitButton className="btn btn-ghost btn-small" pendingText="Resetting…">Build from brand colors</SubmitButton>
            </form>
          </div>
        ) : null}
        {isAdmin ? (
          <div className="preset-grid">
            {GRAPH_PRESETS.map((preset) => (
              <form key={preset.name} action={applyGraphPreset}>
                <input type="hidden" name="preset" value={preset.name} />
                <button type="submit" className="preset">
                  <span className="preset-bars" aria-hidden="true">
                    {preset.colors.map((color) => (
                      <span key={color} style={{ background: color }} />
                    ))}
                  </span>
                  {preset.name}
                </button>
              </form>
            ))}
          </div>
        ) : null}
      </section>

    </>
  )
}
