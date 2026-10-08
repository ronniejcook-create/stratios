import { AiIcon } from './AiIcon'

/**
 * The AI agents column. The analyst isn't connected yet, so the panel says
 * what it will do instead of offering controls that don't work.
 */
export function AgentPanel() {
  return (
    <div className="agent-panel">
      <div className="agent-tabs" role="presentation">
        <span className="agent-tab active">Agents</span>
      </div>
      <div className="agent-picker">
        <AiIcon />
        <span>Portfolio Analyst</span>
        <span className="agent-badge">Coming soon</span>
      </div>
      <div className="agent-empty">
        <p className="agent-empty-title">Ask About Your Portfolio</p>
        <p>
          The analyst will answer questions about your assets and the financial documents you upload, such as occupancy,
          rent roll changes or how a property is performing against budget.
        </p>
        <ul>
          <li>“Which assets are below budget this quarter?”</li>
          <li>“Summarize the latest rent roll for 120 Main St.”</li>
          <li>“Compare NOI across our office properties.”</li>
        </ul>
      </div>
      <div className="agent-composer" aria-disabled="true">
        <span>Message the analyst…</span>
        <span className="agent-send" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </span>
      </div>
    </div>
  )
}
