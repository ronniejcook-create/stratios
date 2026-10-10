'use client'

import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react'

/** How far the pointer must move before a press counts as a drag rather than a click. */
const DRAG_START = 6

/**
 * A box that scrolls its contents, for wide tables. When the contents are
 * wider than the box, holding the mouse button down and dragging left or
 * right slides them sideways, so the scroll bar at the bottom is not the
 * only way across. A press on a button, link or input is left alone, and so
 * is a plain click.
 */
export function ScrollBox({ className, children }: { className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)

  // The grab cursor shows only while there is something to drag to.
  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const mark = () => element.classList.toggle('can-drag', element.scrollWidth > element.clientWidth + 1)
    const observer = new ResizeObserver(mark)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    mark()
    return () => observer.disconnect()
  }, [])

  const down = (event: PointerEvent<HTMLDivElement>) => {
    const element = box.current
    if (!element || event.button !== 0 || event.pointerType !== 'mouse') return
    if (element.scrollWidth <= element.clientWidth + 1) return
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, label')) return
    drag.current = { x: event.clientX, left: element.scrollLeft, moved: false }
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const element = box.current
    const state = drag.current
    if (!element || !state) return
    const distance = event.clientX - state.x
    if (!state.moved) {
      if (Math.abs(distance) < DRAG_START) return
      state.moved = true
      element.classList.add('dragging')
      element.setPointerCapture(event.pointerId)
      window.getSelection()?.removeAllRanges()
    }
    element.scrollLeft = state.left - distance
  }
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const element = box.current
    const state = drag.current
    drag.current = null
    if (!element || !state?.moved) return
    element.classList.remove('dragging')
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
  }

  return (
    <div ref={box} className={`scroll-box${className ? ` ${className}` : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {children}
    </div>
  )
}
