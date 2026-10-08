import { auth, clerkClient } from '@clerk/nextjs/server'
import { DEFAULT_THEME, normalizeHex, parseBrandSettings, parseTheme } from '@/lib/theme'
import { getGeneratedBrand, saveColors, saveGraphColors } from './actions'
import { GraphColorsEditor } from './GraphColorsEditor'
import { chartColorsFromSite, displayChartColors, fitToSurface, parseChartColors } from '@/lib/chartColors'
import { SiteColorsEditor } from './SiteColorsEditor'
import { getOrgSettings } from '@/lib/orgSettings'

export const dynamic = 'force-dynamic'

const MESSAGES: Record<string, { text: string; error?: boolean }> = {
  welcome: { text: 'Your organization is set up. Check the colors below: you can switch to light mode, adjust any color, or use the Stratios colors.' },
  saved: { text: 'Colors saved.' },
  'saved-adjusted': { text: 'Colors saved. Some text colors were adjusted so they stay readable.' },
  'graph-saved': { text: 'Graph colors saved.' },
  'graph-invalid': { text: 'Every graph color needs to be a six-digit hex code, for example #1A1446.', error: true },
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
  const [organization, settings] = await Promise.all([client.organizations.getOrganization({ organizationId: orgId }), getOrgSettings(orgId)])
  const stored = parseTheme(settings.theme)
  const theme = stored ?? DEFAULT_THEME
  const { mode, brand } = parseBrandSettings(settings.theme)
  const generatedRaw = settings.generatedBrand as { primary?: unknown; accent?: unknown } | undefined
  const generatedPrimary = normalizeHex(generatedRaw?.primary)
  const generatedAccent = normalizeHex(generatedRaw?.accent)
  const generatedBrand = generatedPrimary && generatedAccent ? { primary: generatedPrimary, accent: generatedAccent } : null
  const storedChart = parseChartColors(settings.chartColors)
  const chartColors = displayChartColors(storedChart, theme, brand, mode)
  const generatedChartColors = fitToSurface(chartColorsFromSite(theme, brand, mode), theme.surface)
  const chartSource =
    storedChart?.source === 'history' ? 'These are graph colors this organization has used in the past.' :
    storedChart?.source === 'manual' ? 'These graph colors were set by hand.' :
    storedChart?.source === 'preset' ? `These graph colors are the ${storedChart.name ?? 'chosen'} palette.` :
    'These graph colors are generated from your site colors.'
  const domain = settings.domain

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
        <SiteColorsEditor
          key={`${mode}:${Object.values(theme).join()}`}
          saved={theme}
          savedMode={mode}
          savedBrand={brand}
          generatedBrand={generatedBrand}
          canEdit={isAdmin}
          saveAction={saveColors}
          generateAction={getGeneratedBrand}
        />
      </section>

      <section className="panel">
        <h2>Graph Colors</h2>
        <p className="note">Used in order for charts and graphs: Color 1 for the first series, Color 2 for the second, and so on. {chartSource}</p>
        <GraphColorsEditor
          key={`${storedChart?.source ?? 'generated'}:${chartColors.join()}`}
          initial={chartColors}
          initialSource={storedChart?.source === 'preset' ? 'preset' : storedChart ? 'manual' : 'generated'}
          initialPresetName={storedChart?.source === 'preset' ? storedChart.name ?? null : null}
          generatedColors={generatedChartColors}
          canEdit={isAdmin}
          action={saveGraphColors}
        />
      </section>
    </>
  )
}
