'use client'

import { useState } from 'react'
import { AiIcon } from '@/components/AiIcon'
import { GRAPH_PRESETS } from '@/lib/presets'
import { SubmitButton } from './SubmitButton'

// Example shares for the preview pie, largest first, so every color shows.
const SHARES = [22, 18, 15, 13, 11, 9, 7, 5]
// Example values for the preview bar chart.
const BAR_VALUES = [64, 82, 47, 71, 38, 56, 29, 44]
const BAR_MAX = 100

/** A bar with 4px rounded top corners, anchored square to the baseline. */
function barPath(x: number, width: number, top: number, bottom: number): string {
  const r = Math.min(4, (bottom - top) / 2, width / 2)
  return `M ${x} ${bottom} V ${top + r} Q ${x} ${top} ${x + r} ${top} H ${x + width - r} Q ${x + width} ${top} ${x + width} ${top + r} V ${bottom} Z`
}

function slicePath(cx: number, cy: number, r: number, start: number, end: number): string {
  const point = (angle: number) => [cx + r * Math.sin(angle), cy - r * Math.cos(angle)]
  const [x1, y1] = point(start)
  const [x2, y2] = point(end)
  const large = end - start > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
}

const isHex = (value: string) => /^#?[0-9a-fA-F]{6}$/.test(value.trim())
const asHex = (value: string) => `#${value.trim().replace(/^#/, '').toLowerCase()}`

type Source = 'generated' | 'preset' | 'manual'

/**
 * Eight editable graph colors with live pie and bar chart previews and
 * ready-made palettes. Nothing is kept until Save graph colors is clicked.
 */
export function GraphColorsEditor({
  initial,
  initialSource,
  initialPresetName,
  generatedColors,
  canEdit,
  action,
}: {
  initial: string[]
  initialSource: Source
  initialPresetName: string | null
  generatedColors: string[]
  canEdit: boolean
  action: (formData: FormData) => Promise<void>
}) {
  const upper = (colors: string[]) => colors.map((c) => c.toUpperCase())
  const [values, setValues] = useState(upper(initial))
  const [source, setSource] = useState<Source>(initialSource)
  const [presetName, setPresetName] = useState<string | null>(initialPresetName)
  const shown = values.map((v, i) => (isHex(v) ? asHex(v) : initial[i]))
  const dirty = source !== initialSource || presetName !== initialPresetName || values.some((v, i) => v !== upper(initial)[i])

  const choose = (colors: string[], nextSource: Source, name: string | null) => {
    setValues(upper(colors))
    setSource(nextSource)
    setPresetName(name)
  }
  const update = (index: number, value: string) => {
    setValues((current) => current.map((v, i) => (i === index ? value.toUpperCase() : v)))
    setSource('manual')
    setPresetName(null)
  }
  const discard = () => choose(initial, initialSource, initialPresetName)

  const total = SHARES.reduce((a, b) => a + b, 0)
  let angle = 0
  const slices = SHARES.map((share, i) => {
    const start = angle
    angle += (share / total) * Math.PI * 2
    return { d: slicePath(110, 110, 100, start, angle), color: shown[i], label: `Color ${i + 1}`, share: Math.round((share / total) * 100) }
  })

  return (
    <>
      <form action={action}>
        <input type="hidden" name="source" value={source} />
        <input type="hidden" name="presetName" value={presetName ?? ''} />
        <div className="graph-layout">
          <fieldset disabled={!canEdit} className="graph-fields">
            {values.map((value, i) => (
              <div key={i} className="swatch">
                <input type="color" aria-label={`Color ${i + 1}: pick a color`} value={shown[i]} onChange={(e) => update(i, e.target.value)} />
                <div className="swatch-text">
                  <label htmlFor={`chart-${i + 1}`}>Color {i + 1}</label>
                  <input
                    id={`chart-${i + 1}`}
                    name={`chart-${i + 1}`}
                    type="text"
                    className="hex-field"
                    required
                    pattern="#?[0-9a-fA-F]{6}"
                    maxLength={7}
                    spellCheck={false}
                    value={value}
                    onChange={(e) => update(i, e.target.value)}
                    aria-invalid={!isHex(value)}
                  />
                </div>
              </div>
            ))}
          </fieldset>
          <figure className="graph-preview">
            <div className="graph-samples">
              <svg viewBox="0 0 220 220" width="160" height="160" role="img" aria-label="Sample pie chart using the eight graph colors">
                {slices.map((slice) => (
                  <path key={slice.label} d={slice.d} fill={slice.color} stroke="var(--panel)" strokeWidth="2" strokeLinejoin="round">
                    <title>{`${slice.label}: ${slice.share}%`}</title>
                  </path>
                ))}
              </svg>
              <svg viewBox="0 0 300 220" width="218" height="160" role="img" aria-label="Sample bar chart using the eight graph colors">
                {[0, 50, 100].map((tick) => {
                  const y = 190 - (tick / BAR_MAX) * 170
                  return (
                    <g key={tick}>
                      <line x1="28" x2="296" y1={y} y2={y} stroke="var(--line)" strokeWidth="1" />
                      <text x="22" y={y + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{tick}</text>
                    </g>
                  )
                })}
                {BAR_VALUES.map((value, i) => {
                  const slot = 268 / BAR_VALUES.length
                  const width = slot - 10
                  const x = 32 + i * slot + 3
                  const top = 190 - (value / BAR_MAX) * 170
                  return (
                    <g key={i}>
                      <path d={barPath(x, width, top, 190)} fill={shown[i]}>
                        <title>{`Color ${i + 1}: ${value}`}</title>
                      </path>
                      <text x={x + width / 2} y="207" textAnchor="middle" fontSize="11" fill="var(--muted)">{i + 1}</text>
                    </g>
                  )
                })}
              </svg>
            </div>
            <figcaption>
              <ul className="graph-legend">
                {slices.map((slice) => (
                  <li key={slice.label}>
                    <span className="legend-dot" style={{ background: slice.color }} aria-hidden="true" />
                    {slice.label}
                  </li>
                ))}
              </ul>
            </figcaption>
          </figure>
        </div>
        {canEdit ? (
          <div className="button-row">
            <SubmitButton className="btn btn-primary btn-small" pendingText="Saving…">Save graph colors</SubmitButton>
            {dirty ? (
              <>
                <button type="button" className="btn btn-ghost btn-small" onClick={discard}>Discard changes</button>
                <span className="unsaved">Unsaved changes are only a preview until you save.</span>
              </>
            ) : null}
          </div>
        ) : null}
      </form>

      {canEdit ? (
        <div className="start-from">
          <h3>Start from</h3>
          <div className="preset-grid">
            <button type="button" className="preset" onClick={() => choose(generatedColors, 'generated', null)}>
              <span className="preset-bars" aria-hidden="true">
                {generatedColors.map((color, i) => (
                  <span key={i} style={{ background: color }} />
                ))}
              </span>
              <AiIcon />
              Generated Brand Colors
            </button>
            {GRAPH_PRESETS.map((preset) => (
              <button key={preset.name} type="button" className="preset" onClick={() => choose(preset.colors, 'preset', preset.name)}>
                <span className="preset-bars" aria-hidden="true">
                  {preset.colors.map((color, i) => (
                    <span key={i} style={{ background: color }} />
                  ))}
                </span>
                {preset.name}
              </button>
            ))}
          </div>
          <p className="note">
            Choosing a palette previews it in the charts above; click Save graph colors to keep it. Generated Brand Colors are
            built from your saved site colors: your accent color first, then muted shades related to your site&apos;s colors.
          </p>
        </div>
      ) : null}
    </>
  )
}
