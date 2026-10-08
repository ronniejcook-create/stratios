'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/** A small pop-up panel that opens under its trigger button. */
export function Menu({
  label,
  trigger,
  triggerClassName,
  children,
}: {
  label: string
  trigger: ReactNode
  triggerClassName?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className={triggerClassName ?? 'menu-trigger'}
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open ? (
        <div id={panelId} className="menu-panel" onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
