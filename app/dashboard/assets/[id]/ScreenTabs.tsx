'use client'

import { useState, type ReactNode } from 'react'

/**
 * The tabs across the top of an asset. Every screen is already on the page,
 * so switching only shows a different one: no reload, and anything being
 * edited on another tab is kept.
 */
export function ScreenTabs({
  screens,
  initialKey,
  basePath,
}: {
  screens: { key: string; name: string; content: ReactNode }[]
  initialKey: string
  basePath: string
}) {
  const [active, setActive] = useState(screens.some((screen) => screen.key === initialKey) ? initialKey : screens[0]?.key ?? '')

  const select = (key: string) => {
    setActive(key)
    // Keep the address in step, so a reload or a shared link opens the same tab.
    const url = key === screens[0]?.key ? basePath : `${basePath}?screen=${encodeURIComponent(key)}`
    window.history.replaceState(null, '', url)
  }

  return (
    <>
      {screens.length > 1 ? (
        <div className="screen-tabs" role="tablist" aria-label="Screens">
          {screens.map((screen) => (
            <button
              key={screen.key}
              type="button"
              role="tab"
              id={`screen-tab-${screen.key}`}
              aria-selected={screen.key === active}
              aria-controls={`screen-panel-${screen.key}`}
              className={`screen-tab${screen.key === active ? ' active' : ''}`}
              onClick={() => select(screen.key)}
            >
              {screen.name}
            </button>
          ))}
        </div>
      ) : null}
      {screens.map((screen) => (
        <div key={screen.key} role="tabpanel" id={`screen-panel-${screen.key}`} aria-labelledby={`screen-tab-${screen.key}`} hidden={screen.key !== active}>
          {screen.content}
        </div>
      ))}
    </>
  )
}
