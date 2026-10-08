'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * Something on the page the person has pointed the agent at, such as one
 * field's value. `reference` is the exact, permanent address of it, for
 * example property:120-main-st.netOperatingIncome@2026-03.
 */
export type AgentReference = {
  reference: string
  label: string
  detail?: string
}

type AgentReferences = {
  references: AgentReference[]
  addReference: (reference: AgentReference) => void
  removeReference: (reference: string) => void
  clearReferences: () => void
}

const NONE: AgentReferences = { references: [], addReference: () => {}, removeReference: () => {}, clearReferences: () => {} }

const AgentReferenceContext = createContext<AgentReferences>(NONE)

export function AgentReferenceProvider({ value, children }: { value: AgentReferences; children: ReactNode }) {
  return <AgentReferenceContext.Provider value={value}>{children}</AgentReferenceContext.Provider>
}

/** The fields the person has pointed the agent at, and ways to change that list. */
export function useAgentReferences(): AgentReferences {
  return useContext(AgentReferenceContext)
}
