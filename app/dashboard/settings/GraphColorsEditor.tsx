'use client'

import { useState } from 'react'
import { SubmitButton } from './SubmitButton'

// Example shares for the preview pie, largest first, so every color shows.
const SHARES = [22, 18, 15, 13, 11, 9, 7, 5]

function slicePath(cx: number, cy: number, r: number, start: number, end: number): string {
  const point = (angle: number) => [cx + r * Math.sin(angle), cy - r * Math.cos(angle)]
  const [x1, y1] = point(start)
  const [x2, y2] = point(end)
  const large = end - start > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
}

const isHex = (value: string) => /^#?[0-9a-fA-F]{6}$/.test(value.trim())
const asHex = (value: string) => `#${value.trim().replace(/^#/, '').toLowerCase()}`

/** Eight editable graph colors with a live pie chart preview. */
export function GraphColorsEditor({ initial, canEdit, action }: { initial: string[]; canEdit: boolean; action: (formData: FormData) => Promise<void> }) {
  const [values, setValues] = useState(initial.map((c) => c.toUpperCase()))
  const shown = values.map((v, i) => (isHex(v) ? asHex(v) : initial[i]))
  const total = SHARES.reduce((a, b) => a + b, 0)

  let angle = 0
  const slices = SHARES.map((share, i) => {
    const start = angle
    angle += (share / total) * Math.PI * 2
    return { d: slicePath(110, 110, 100, start, angle), color: shown[i], label: `Color ${i + 1}`, share: Math.round((share / total) * 100) }
  })

  const update = (index: number, value: string) => setValues((current) => current.map((v, i) => (i === index ? value.toUpperCase() : v)))

  return (
    <form action={action}>
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
          <svg viewBox="0 0 220 220" width="220" height="220" role="img" aria-label="Sample pie chart using the eight graph colors">
            {slices.map((slice) => (
              <path key={slice.label} d={slice.d} fill={slice.color} stroke="var(--panel)" strokeWidth="2" strokeLinejoin="round">
                <title>{`${slice.label}: ${slice.share}%`}</title>
              </path>
            ))}
          </svg>
          <figcaption>
            <ul className="graph-legend">
              {slices.map((slice) => (
                <li key={slice.label}>
                  <span className="legend-dot" style={{ background: slice.color }} aria-hidden="true" />
                  {slice.label}
                  <span className="legend-share">{slice.share}%</span>
                </li>
              ))}
            </ul>
          </figcaption>
        </figure>
      </div>
      {canEdit ? (
        <div className="button-row">
          <SubmitButton className="btn btn-primary btn-small" pendingText="Saving…">Save graph colors</SubmitButton>
        </div>
      ) : null}
    </form>
  )
}
