'use client'

import { useId, useState } from 'react'

/** One site color: a color picker and an editable hex code that stay in step. */
export function SwatchField({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  const [hex, setHex] = useState(defaultValue.toUpperCase())
  const id = useId()
  const valid = /^#?[0-9a-fA-F]{6}$/.test(hex.trim())
  const pickerValue = valid ? `#${hex.trim().replace(/^#/, '').toLowerCase()}` : defaultValue

  return (
    <div className="swatch">
      <input
        type="color"
        aria-label={`${label}: pick a color`}
        value={pickerValue}
        onChange={(event) => setHex(event.target.value.toUpperCase())}
      />
      <div className="swatch-text">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          name={name}
          type="text"
          className="hex-field"
          required
          pattern="#?[0-9a-fA-F]{6}"
          maxLength={7}
          spellCheck={false}
          value={hex}
          onChange={(event) => setHex(event.target.value.toUpperCase())}
          aria-invalid={!valid}
        />
      </div>
    </div>
  )
}
