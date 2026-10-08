'use client'

import { useCallback, useMemo, useState, type ReactNode } from 'react'
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

/**
 * The signed-in workspace: a top bar, navigation on the left, the page in the
 * middle and the AI agent panel on the right. Either side column can be hidden.
 */
export function AppShell({ brand, tools, isAdmin, children }: { brand: ReactNode; tools: ReactNode; isAdmin: boolean; children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(true)
  const [agentOpen, setAgentOpen] = useState(true)

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
    <div className={`shell${navOpen ? '' : ' nav-closed'}${agentOpen ? '' : ' agent-closed'}`}>
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
        <SideNav isAdmin={isAdmin} />
      </aside>
      <main className="shell-main app-main">{children}</main>
      <aside className="shell-agent" aria-label="AI agents">
        <AgentPanel />
      </aside>
    </div>
    </AgentReferenceProvider>
  )
}
