'use client'

import { useState, useTransition } from 'react'
import { AiIcon } from '@/components/AiIcon'
import { SITE_PRESETS } from '@/lib/presets'
import {
  DEFAULT_BRAND,
  THEME_ROLES,
  deriveTheme,
  inferBrand,
  themeVars,
  type BrandColors,
  type OrgTheme,
  type ThemeMode,
} from '@/lib/theme'
import type { getGeneratedBrand } from './actions'
import { SubmitButton } from './SubmitButton'

type Props = {
  saved: OrgTheme
  savedMode: ThemeMode
  savedBrand: BrandColors | null
  generatedBrand: BrandColors | null
  canEdit: boolean
  saveAction: (formData: FormData) => Promise<void>
  generateAction: typeof getGeneratedBrand
}

const isHex = (value: string) => /^#?[0-9a-fA-F]{6}$/.test(value.trim())
const asHex = (value: string) => `#${value.trim().replace(/^#/, '').toLowerCase()}`

/**
 * Site colors with Dark/Light, ready-made schemes and per-color editing.
 * Changes are previewed across the app straight away but only kept when
 * Save colors is clicked; leaving the page or Discard changes drops them.
 */
export function SiteColorsEditor({ saved, savedMode, savedBrand, generatedBrand, canEdit, saveAction, generateAction }: Props) {
  const toValues = (theme: OrgTheme) => THEME_ROLES.map((role) => theme[role.key].toUpperCase())
  const [values, setValues] = useState(() => toValues(saved))
  const [mode, setMode] = useState<ThemeMode>(savedMode)
  const [brand, setBrand] = useState<BrandColors | null>(savedBrand)
  const [generated, setGenerated] = useState<BrandColors | null>(generatedBrand)
  const [message, setMessage] = useState<string | null>(null)
  const [generating, startGenerating] = useTransition()

  const savedValues = toValues(saved)
  const dirty = mode !== savedMode || values.some((v, i) => v.toUpperCase() !== savedValues[i])

  // The theme being previewed (invalid hex codes fall back to the saved color).
  const preview = {} as OrgTheme
  THEME_ROLES.forEach((role, i) => {
    preview[role.key] = isHex(values[i]) ? asHex(values[i]) : saved[role.key]
  })

  const applyBrand = (next: BrandColors, nextMode = mode) => {
    setBrand(next)
    setMode(nextMode)
    setValues(toValues(deriveTheme(next.primary, next.accent, nextMode)))
    setMessage(null)
  }
  const switchMode = (nextMode: ThemeMode) => applyBrand(brand ?? inferBrand(preview), nextMode)
  const discard = () => {
    setValues(savedValues)
    setMode(savedMode)
    setBrand(savedBrand)
    setMessage(null)
  }
  const useGenerated = () => {
    if (generated) return applyBrand(generated)
    startGenerating(async () => {
      const result = await generateAction()
      if ('error' in result) {
        setMessage(result.error)
        return
      }
      setGenerated(result.brand)
      applyBrand(result.brand)
    })
  }

  // Preview: override the app's colors while there are unsaved changes. The
  // style tag disappears with this component, so leaving the page reverts.
  const previewCss = dirty
    ? `.org-theme{${Object.entries(themeVars(preview)).map(([name, value]) => `${name}:${value} !important`).join(';')}}`
    : ''

  return (
    <>
      {previewCss ? <style>{previewCss}</style> : null}
      {canEdit ? (
        <div className="mode-toggle" role="group" aria-label="Color mode">
          <button type="button" aria-pressed={mode === 'dark'} onClick={() => switchMode('dark')}>Dark</button>
          <button type="button" aria-pressed={mode === 'light'} onClick={() => switchMode('light')}>Light</button>
        </div>
      ) : (
        <p className="note">Mode: {mode === 'light' ? 'Light' : 'Dark'}</p>
      )}

      <form action={saveAction}>
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="brandPrimary" value={brand?.primary ?? ''} />
        <input type="hidden" name="brandAccent" value={brand?.accent ?? ''} />
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="swatches">
            {THEME_ROLES.map((role, i) => (
              <div key={role.key} className="swatch">
                <input
                  type="color"
                  aria-label={`${role.label}: pick a color`}
                  value={preview[role.key]}
                  onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))}
                />
                <div className="swatch-text">
                  <label htmlFor={`site-${role.key}`}>{role.label}</label>
                  <input
                    id={`site-${role.key}`}
                    name={role.key}
                    type="text"
                    className="hex-field"
                    required
                    pattern="#?[0-9a-fA-F]{6}"
                    maxLength={7}
                    spellCheck={false}
                    value={values[i]}
                    onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))}
                    aria-invalid={!isHex(values[i])}
                  />
                </div>
              </div>
            ))}
          </div>
          {canEdit ? (
            <div className="button-row">
              <SubmitButton className="btn btn-primary btn-small" pendingText="Saving…">Save colors</SubmitButton>
              {dirty ? (
                <>
                  <button type="button" className="btn btn-ghost btn-small" onClick={discard}>Discard changes</button>
                  <span className="unsaved">Unsaved changes are only a preview until you save.</span>
                </>
              ) : null}
            </div>
          ) : (
            <p className="note">Only administrators can change the colors.</p>
          )}
        </fieldset>
      </form>

      {canEdit ? (
        <div className="start-from">
          <h3>Start From</h3>
          {message ? <p className="form-error" role="alert">{message}</p> : null}
          <div className="preset-grid">
            <button type="button" className="preset" onClick={useGenerated} disabled={generating}>
              <span className="preset-dots" aria-hidden="true">
                {generated ? (
                  <>
                    <span style={{ background: generated.primary }} />
                    <span style={{ background: generated.accent }} />
                  </>
                ) : null}
              </span>
              <AiIcon />
              {generating ? 'Generating brand colors…' : 'Generated Brand Colors'}
            </button>
            <button type="button" className="preset" onClick={() => applyBrand(DEFAULT_BRAND)}>
              <span className="preset-dots" aria-hidden="true">
                <span style={{ background: DEFAULT_BRAND.primary }} />
                <span style={{ background: DEFAULT_BRAND.accent }} />
              </span>
              Stratios
            </button>
            {SITE_PRESETS.map((preset) => (
              <button key={preset.name} type="button" className="preset" onClick={() => applyBrand({ primary: preset.primary, accent: preset.accent })}>
                <span className="preset-dots" aria-hidden="true">
                  <span style={{ background: preset.primary }} />
                  <span style={{ background: preset.accent }} />
                </span>
                {preset.name}
              </button>
            ))}
          </div>
          <p className="note">
            Choosing an option or switching Dark/Light rebuilds all ten colors and previews them; click Save colors to keep them.
            Generated Brand Colors are the colors Stratios found for your organization when it was set up.
          </p>
        </div>
      ) : null}
    </>
  )
}
