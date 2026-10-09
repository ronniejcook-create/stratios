'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useUser } from '@clerk/nextjs'
import { AgentReferenceProvider, type AgentReference } from './AgentContext'
import { AgentPanel } from './AgentPanel'
import { SideNav } from './SideNav'

function PanelIcon({ side }: { side: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d={side === 'left' ? 'M9 4v16' : 'M15 4v16'} />
    </svg>
  )
}

// The AI agents column can be dragged wider or narrower by its left edge.
const AGENT_DEFAULT = 360
const AGENT_MIN = 300
const AGENT_MAX = 900
/** The page in the middle always keeps at least this much room. */
const MAIN_MIN = 420

const widthKey = (userId: string) => `stratios.agentWidth.${userId}`

/** Keeps a width inside what the column allows and what this window has room for. */
function fitWidth(width: number): number {
  const room = typeof window === 'undefined' ? AGENT_MAX : window.innerWidth - MAIN_MIN
  return Math.round(Math.max(AGENT_MIN, Math.min(width, AGENT_MAX, room)))
}

/**
 * The signed-in workspace: a top bar, navigation on the left, the page in the
 * middle and the AI agent panel on the right. Either side column can be hidden.
 */
export function AppShell({
  brand,
  tools,
  isAdmin,
  isStratiosAdmin = false,
  children,
}: {
  brand: ReactNode
  tools: ReactNode
  isAdmin: boolean
  isStratiosAdmin?: boolean
  children: ReactNode
}) {
  const [navOpen, setNavOpen] = useState(true)
  const [agentOpen, setAgentOpen] = useState(true)

  // The width of the agents column is each person's own preference. It is kept
  // on their account, so it follows them to other computers, and in this
  // browser, so it is in place straight away on the next visit.
  const { user } = useUser()
  const [agentWidth, setAgentWidth] = useState(AGENT_DEFAULT)
  const [resizing, setResizing] = useState(false)
  const latestWidth = useRef(AGENT_DEFAULT)
  const userId = user?.id ?? null
  const savedOnAccount = user?.unsafeMetadata?.agentWidth
  useEffect(() => {
    if (!userId) return
    let saved: number | null = typeof savedOnAccount === 'number' ? savedOnAccount : null
    if (saved === null) {
      try {
        const local = Number(window.localStorage.getItem(widthKey(userId)))
        if (Number.isFinite(local) && local > 0) saved = local
      } catch {
        // Private windows can refuse storage; the default width is used.
      }
    }
    if (saved !== null) {
      latestWidth.current = fitWidth(saved)
      setAgentWidth(latestWidth.current)
    }
  }, [userId, savedOnAccount])

  const changeWidth = useCallback((width: number) => {
    latestWidth.current = fitWidth(width)
    setAgentWidth(latestWidth.current)
  }, [])

  const rememberWidth = useCallback(() => {
    if (!user) return
    const width = latestWidth.current
    try {
      window.localStorage.setItem(widthKey(user.id), String(width))
    } catch {
      // Nothing to do; the account copy below still applies.
    }
    if (user.unsafeMetadata?.agentWidth !== width) {
      user.update({ unsafeMetadata: { ...user.unsafeMetadata, agentWidth: width } }).catch((error) => console.error('Saving the column width failed', error))
    }
  }, [user])

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(true)
  }
  const moveResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizing) changeWidth(window.innerWidth - event.clientX)
  }
  const endResize = () => {
    if (!resizing) return
    setResizing(false)
    rememberWidth()
  }
  const keyResize = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowLeft' ? 24 : event.key === 'ArrowRight' ? -24 : 0
    if (step === 0) return
    event.preventDefault()
    changeWidth(latestWidth.current + step)
    rememberWidth()
  }

  // Fields the person has clicked to point the agent at. Clicking one also
  // opens the agent column so the reference is visible.
  const [references, setReferences] = useState<AgentReference[]>([])
  const addReference = useCallback((next: AgentReference) => {
    setReferences((current) => [...current.filter((item) => item.reference !== next.reference), next].slice(-8))
    setAgentOpen(true)
  }, [])
  const removeReference = useCallback((reference: string) => {
    setReferences((current) => current.filter((item) => item.reference !== reference))
  }, [])
  const clearReferences = useCallback(() => setReferences([]), [])
  const agentReferences = useMemo(
    () => ({ references, addReference, removeReference, clearReferences }),
    [references, addReference, removeReference, clearReferences],
  )

  return (
    <AgentReferenceProvider value={agentReferences}>
    <div
      className={`shell${navOpen ? '' : ' nav-closed'}${agentOpen ? '' : ' agent-closed'}${resizing ? ' agent-resizing' : ''}`}
      style={{ '--agent-open-width': `${agentWidth}px` } as CSSProperties}
    >
      <header className="shell-top">
        <div className="shell-top-left">
          <button
            type="button"
            className="icon-button"
            aria-label={navOpen ? 'Hide navigation' : 'Show navigation'}
            aria-pressed={navOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            <PanelIcon side="left" />
          </button>
          {brand}
        </div>
        <div className="shell-top-right">
          {tools}
          <button
            type="button"
            className="icon-button agent-toggle"
            aria-label={agentOpen ? 'Hide AI agents' : 'Show AI agents'}
            aria-pressed={agentOpen}
            onClick={() => setAgentOpen((v) => !v)}
          >
            <PanelIcon side="right" />
          </button>
        </div>
      </header>
      <aside className="shell-nav" aria-label="Navigation">
        <SideNav isAdmin={isAdmin} isStratiosAdmin={isStratiosAdmin} />
      </aside>
      <main className="shell-main app-main">{children}</main>
      <aside className="shell-agent" aria-label="AI agents">
        <div
          className="agent-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the AI agents column"
          aria-valuemin={AGENT_MIN}
          aria-valuemax={AGENT_MAX}
          aria-valuenow={agentWidth}
          tabIndex={0}
          title="Drag to resize. Double-click to reset."
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onKeyDown={keyResize}
          onDoubleClick={() => {
            changeWidth(AGENT_DEFAULT)
            rememberWidth()
          }}
        />
        <AgentPanel />
      </aside>
    </div>
    </AgentReferenceProvider>
  )
}
