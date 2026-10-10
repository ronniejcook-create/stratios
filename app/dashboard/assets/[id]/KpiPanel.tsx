'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { recalculateKpis } from '@/lib/documentClient'
import { formatDate, formatPeriod } from '@/lib/fieldFormat'
import { chooseCalculatedValue } from './actions'

export type KpiRow = {
  fieldId: string
  name: string
  /** "Oct 2026" style month for a value kept per month, else null. */
  period: string | null
  display: string
  working: string
  outcome: 'filled' | 'replaced' | 'same' | 'kept'
  /** What the field held instead, and where it came from, for a kept value. */
  current: string | null
  currentSource: string | null
  /** Whether this person may make the calculated figure the field's value. */
  canChoose: boolean
}

export type KpiRunView = {
  id: string
  propertyName: string
  asOfDate: string
  skillName: string | null
  notes: string | null
  /** When the calculation ran, as an ISO time. */
  createdAt: string
  rows: KpiRow[]
}

const OUTCOME: Record<KpiRow['outcome'], string> = { filled: 'Saved', replaced: 'Updated', same: 'Unchanged', kept: 'Not Used' }

function when(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * KPIs calculated from the stored leases, on the Leases tab: the Recalculate
 * button and, for each property, what the last calculation worked out and how.
 * Which values are calculated, and the logic for each, come from the KPI
 * skill that fits the property's kind.
 */
export function KpiPanel({ assetId, runs, canCalculate, severalProperties }: { assetId: string; runs: KpiRunView[]; canCalculate: boolean; severalProperties: boolean }) {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [choosing, startChoosing] = useTransition()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  const recalculate = async () => {
    setMessage(null)
    setWorking(true)
    const result = await recalculateKpis(assetId)
    setWorking(false)
    setMessage(result.ok ? { text: result.message, error: false } : { text: result.error, error: true })
    if (result.ok) router.refresh()
  }
  const choose = (runId: string, fieldId: string) => {
    setMessage(null)
    startChoosing(async () => {
      const result = await chooseCalculatedValue({ runId, fieldId })
      setMessage(result.ok ? { text: result.message, error: false } : { text: result.error, error: true })
      if (result.ok) router.refresh()
    })
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>KPIs From Leases</h2>
        {canCalculate ? (
          <button type="button" className="btn btn-primary btn-small" disabled={working || choosing} onClick={recalculate}>
            {working ? 'Calculating…' : 'Recalculate KPIs'}
          </button>
        ) : null}
      </div>
      <p className="note">
        Calculated by the agent from the leases and the latest rent roll. Which values are calculated, and how, is set by the skill for the property&apos;s kind: Calculating
        Commercial KPIs or Calculating Residential KPIs in the Skills Library. A figure a document shows, or one a person entered, is never overwritten; the calculated figure is
        listed beside it instead.
      </p>
      {working ? <p className="note" role="status">This takes up to a minute or two. You can keep working; the page updates when it is done.</p> : null}
      {message ? <p className={message.error ? 'form-error' : 'form-ok'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}

      {runs.length === 0 ? (
        <p className="note" role="status">Nothing has been calculated yet.{canCalculate ? ' Press Recalculate KPIs to work them out from the leases below.' : ''}</p>
      ) : (
        runs.map((run) => (
          <div key={run.id} className="kpi-run">
            <h3>{severalProperties ? `${run.propertyName}: ` : ''}Rent Roll as of {formatDate(run.asOfDate)}</h3>
            <p className="doc-sub">
              {run.skillName ? <>Followed the skill <strong>{run.skillName}</strong>.</> : 'No KPI skill fitted this property, so nothing was calculated.'} Calculated {when(run.createdAt)}.
            </p>
            {run.rows.length > 0 ? (
              <div className="table-scroll">
                <table className="lease-table kpi-table">
                  <thead>
                    <tr><th scope="col">Value</th><th scope="col" className="num">Calculated</th><th scope="col">Result</th><th scope="col">How It Was Worked Out</th></tr>
                  </thead>
                  <tbody>
                    {run.rows.map((row) => (
                      <tr key={`${row.fieldId}-${row.period ?? ''}`}>
                        <th scope="row">{row.name}{row.period ? <span className="kpi-period"> {formatPeriod(row.period)}</span> : null}</th>
                        <td className="num">{row.display}</td>
                        <td>
                          <span className={`chip${row.outcome === 'kept' ? ' chip-modified' : ''}`}>{OUTCOME[row.outcome]}</span>
                          {row.outcome === 'kept' ? (
                            <span className="kpi-kept">
                              The field holds {row.current}{row.currentSource ? ` from ${row.currentSource}` : ''}.{' '}
                              {row.canChoose ? (
                                <button type="button" className="link-button" disabled={working || choosing} onClick={() => choose(run.id, row.fieldId)}>Use Calculated Value</button>
                              ) : null}
                            </span>
                          ) : row.outcome === 'replaced' && row.current ? (
                            <span className="kpi-kept">Was {row.current}.</span>
                          ) : null}
                        </td>
                        <td className="kpi-working">{row.working}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {run.notes ? <p className="note">{run.notes}</p> : null}
          </div>
        ))
      )}
    </section>
  )
}
