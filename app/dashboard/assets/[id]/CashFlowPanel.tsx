'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AiIcon } from '@/components/AiIcon'
import { DownloadIcon, Modal } from '@/components/DataGrid'
import { downloadWorkbook, type SheetCell } from '@/lib/excelExport'
import { ScrollBox } from '@/components/ScrollBox'
import {
  byCategory, CASH_FLOW_COLUMN_LABELS, CASH_FLOW_SECTION_LABELS, CASH_FLOW_SECTIONS, checkTotals, columnSums, periodTotals,
  type CashFlowColumn, type CashFlowFigure, type CashFlowLine, type CashFlowSection,
} from '@/lib/cashFlows'
import { loadCashFlow } from '@/lib/documentClient'
import { removeCashFlow } from './actions'

export type CashFlowChoice = {
  id: string
  /** The months the statement covers, in words: "Jan 2025 to Dec 2025". */
  period: string
  propertyName: string
  title: string | null
  basis: string | null
  documentId: string | null
  documentName: string | null
  lineCount: number
  /** What the agent said about the statement when it copied it. */
  notes: string | null
  columns: CashFlowColumn[]
}

/** A figure as a statement prints it: commas, and parentheses for a negative. */
function figure(amount: number | null | undefined, cents: boolean): string {
  if (amount === null || amount === undefined) return ''
  const digits = cents ? 2 : 0
  const text = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  // A figure that rounds to nothing is shown as a plain zero, never as "(0)".
  return amount < 0 && Number(Math.abs(amount).toFixed(digits)) !== 0 ? `(${text})` : text
}
const dollars = (amount: number | null, cents: boolean) => (amount === null ? '–' : `${amount < 0 ? '-' : ''}$${figure(Math.abs(amount), cents)}`)

const TOTAL_NAMES: Record<'income' | 'expenses' | 'noi', string> = { income: 'Total Income', expenses: 'Total Operating Expenses', noi: 'Net Operating Income' }

/**
 * The Cash Flow tab of an asset: one operating statement at a time, chosen
 * from those that have been loaded, with its headline figures and its lines
 * month by month, as the document shows them or added up by category.
 */
export function CashFlowPanel({
  assetId,
  choices,
  selectedId,
  lines,
  canEdit,
  severalProperties,
  documents,
}: {
  assetId: string
  choices: CashFlowChoice[]
  selectedId: string | null
  lines: CashFlowLine[]
  canEdit: boolean
  severalProperties: boolean
  /** The asset's documents that have been read, for Load From a Document. */
  documents: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [mode, setMode] = useState<'view' | 'load' | 'remove'>('view')
  const [view, setView] = useState<'lines' | 'categories'>('lines')
  const [documentId, setDocumentId] = useState('')
  const [loading, setLoading] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selected = choices.find((choice) => choice.id === selectedId) ?? null

  const open = (id: string | null) => router.push(`/dashboard/assets/${assetId}?screen=_cashflow${id ? `&cashFlow=${id}` : ''}`)

  const load = async () => {
    const document = documents.find((entry) => entry.id === documentId)
    if (!document) return
    setError(null)
    setDone(null)
    setLoading(document.name)
    const result = await loadCashFlow(document.id)
    setLoading(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setMode('view')
    setDone(result.message)
    if (result.found && result.cashFlowId) router.replace(`/dashboard/assets/${assetId}?screen=_cashflow&cashFlow=${result.cashFlowId}`)
    router.refresh()
  }

  const loadForm =
    mode === 'load' ? (
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          void load()
        }}
      >
        <div className="field field-wide">
          <label htmlFor="cash-flow-document">Document</label>
          <select id="cash-flow-document" value={documentId} onChange={(event) => setDocumentId(event.target.value)} disabled={loading !== null} required>
            <option value="">Choose a document…</option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>{document.name}</option>
            ))}
          </select>
        </div>
        <div className="field-edit-buttons">
          <button type="submit" className="btn btn-primary btn-small" disabled={loading !== null || !documentId}>{loading ? 'Copying…' : 'Load Cash Flow'}</button>
          <button type="button" className="btn btn-ghost btn-small" disabled={loading !== null} onClick={() => { setMode('view'); setError(null) }}>Cancel</button>
        </div>
        {loading ? (
          <p className="note cash-flow-progress" role="status">
            <AiIcon /> Copying the statement in {loading}, line by line. This can take a few minutes; keep this page open.
          </p>
        ) : (
          <p className="note">The agent copies the operating statement in the document you choose. Loading a document again replaces the statement that came from it.</p>
        )}
      </form>
    ) : null
  const loadButton =
    canEdit && documents.length > 0 && mode === 'view' ? (
      <button type="button" className="btn btn-ghost btn-small" onClick={() => { setError(null); setDone(null); setDocumentId(''); setMode('load') }}>Load From a Document</button>
    ) : null

  if (!selected) {
    return (
      <section className="panel">
        <h2>Cash Flow</h2>
        {done ? <p className="form-ok" role="status">{done}</p> : null}
        <p className="empty">
          No cash flow has been loaded for this asset yet.
          {canEdit ? ' Drop an operating statement, such as a trailing twelve months (PDF or Excel), on the agent column and ask the analyst to load it, or upload it on the Documents tab. Its lines are copied month by month and kept here.' : ''}
        </p>
        {loadButton ? <div className="button-row">{loadButton}</div> : null}
        {loadForm}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>
    )
  }

  const { columns } = selected
  const label = (choice: CashFlowChoice) =>
    `${choice.period}${severalProperties ? ` · ${choice.propertyName}` : ''}${choice.title ? ` · ${choice.title}` : ''} · ${choice.lineCount} ${choice.lineCount === 1 ? 'line' : 'lines'}`
  // Cents are shown when the document shows them anywhere, so every figure reads as it does on the page.
  const cents = lines.some((line) => line.amounts.some((amount) => amount !== null && Math.abs(amount - Math.round(amount)) > 0.004))
  const sums = columnSums(lines, columns.length)
  const totals = periodTotals(columns, lines)
  const checks = checkTotals(columns, lines)
  const mixed = new Set(columns.map((column) => column.kind)).size > 1
  const source = (shown: CashFlowFigure) => (shown.amount === null ? '' : shown.stated ? 'As the document shows' : 'Added up from the lines')
  const tiles: { label: string; value: string; sub: string }[] = totals
    ? [
        { label: 'Total Income', value: dollars(totals.income.amount, false), sub: source(totals.income) },
        { label: 'Operating Expenses', value: dollars(totals.expenses.amount, false), sub: source(totals.expenses) },
        { label: 'Net Operating Income', value: dollars(totals.noi.amount, false), sub: source(totals.noi) },
      ]
    : []
  const covers = !totals
    ? ''
    : totals.from === 'total'
      ? `These are the figures in the document's "${totals.label}" column (${totals.months} ${totals.months === 1 ? 'month' : 'months'}).`
      : totals.from === 'column'
        ? `These are the figures in the "${totals.label}" column, the latest period in the statement.`
        : `The document has no total column, so these are its ${totals.months} month columns added together.`
  const categories = byCategory(lines, columns.length)
  const uncategorized = categories.some((row) => row.category === 'Not Categorized')

  // The download holds the view on screen: the lines as the document shows them, or added up by category.
  const download = () => {
    const amounts = (values: (number | null | undefined)[]): SheetCell[] => columns.map((_column, index) => (values[index] === null || values[index] === undefined ? null : { value: values[index] as number, format: cents ? 'cents' : 'whole' }))
    const labels = columns.map((column) => (mixed || column.kind !== 'actual' ? `${column.label} (${CASH_FLOW_COLUMN_LABELS[column.kind]})` : column.label))
    const name = `${selected.propertyName} Cash Flow ${selected.period}`
    if (view === 'lines') {
      downloadWorkbook(name, 'Cash Flow', ['Account', 'Line', 'Part', 'Category', ...labels], lines.map((line) => [line.code, line.name, CASH_FLOW_SECTION_LABELS[line.section], line.category, ...amounts(line.amounts)]))
      return
    }
    const rows: SheetCell[][] = []
    for (const section of CASH_FLOW_SECTIONS) {
      for (const row of categories.filter((entry) => entry.section === section)) rows.push([CASH_FLOW_SECTION_LABELS[section], row.category, ...amounts(row.amounts)])
      if (section === 'income') rows.push(['', TOTAL_NAMES.income, ...amounts(sums.map((sum) => sum.income.amount))])
      if (section === 'expense') rows.push(['', TOTAL_NAMES.expenses, ...amounts(sums.map((sum) => sum.expenses.amount))], ['', TOTAL_NAMES.noi, ...amounts(sums.map((sum) => sum.noi.amount))])
    }
    downloadWorkbook(`${name} by Category`, 'By Category', ['Part', 'Category', ...labels], rows)
  }

  const head = (
    <thead>
      <tr>
        <th scope="col">{view === 'lines' ? 'Line' : 'Category'}</th>
        {columns.map((column, index) => (
          <th key={index} scope="col" className={`cash-flow-amount${column.total ? ' cash-flow-total-column' : ''}`}>
            {column.label}
            {mixed || column.kind !== 'actual' ? <span className="cash-flow-column-kind">{CASH_FLOW_COLUMN_LABELS[column.kind]}</span> : null}
          </th>
        ))}
      </tr>
    </thead>
  )
  const amountCells = (amounts: (number | null | undefined)[]) =>
    columns.map((column, index) => (
      <td key={index} className={`cash-flow-amount${column.total ? ' cash-flow-total-column' : ''}${(amounts[index] ?? 0) < 0 ? ' cash-flow-negative' : ''}`}>{figure(amounts[index], cents)}</td>
    ))
  const sectionRow = (section: CashFlowSection) => (
    <tr key={`section-${section}`} className="cash-flow-heading">
      <th scope="row" colSpan={columns.length + 1}><span className="cash-flow-heading-text">{CASH_FLOW_SECTION_LABELS[section]}</span></th>
    </tr>
  )
  const totalRow = (which: 'income' | 'expenses' | 'noi') => {
    const figures = sums.map((sum) => sum[which])
    if (figures.every((entry) => entry.amount === null)) return null
    return (
      <tr key={`total-${which}`} className={which === 'noi' ? 'cash-flow-noi' : 'cash-flow-sum'}>
        <th scope="row">{TOTAL_NAMES[which]}</th>
        {amountCells(figures.map((entry) => entry.amount))}
      </tr>
    )
  }

  return (
    <section className="panel">
      <h2>Cash Flow</h2>
      <div className="rent-roll-head">
        {choices.length > 1 ? (
          <div className="field">
            <label htmlFor="cash-flow-choice">Statement</label>
            <select id="cash-flow-choice" value={selected.id} onChange={(event) => open(event.target.value)}>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>{label(choice)}</option>
              ))}
            </select>
          </div>
        ) : (
          <p className="rent-roll-date">{label(selected)}</p>
        )}
        {canEdit && mode === 'view' ? (
          <span className="rent-roll-actions">
            {loadButton}
            <button type="button" className="btn btn-ghost btn-small danger" onClick={() => { setError(null); setMode('remove') }}>Delete Cash Flow</button>
          </span>
        ) : null}
      </div>

      {loadForm}
      <Modal open={mode === 'remove'} title="Delete This Cash Flow?" onClose={() => { if (!busy) setMode('view') }}>
        <p className="modal-text">
          The statement for <strong>{selected.period}</strong> and its {selected.lineCount} {selected.lineCount === 1 ? 'line' : 'lines'} will be permanently deleted. Other statements on this asset are not touched,
          the document it came from is kept, and values already filled in from the document stay.
        </p>
        <p className="modal-text modal-warning">This cannot be undone. Are you sure?</p>
        {mode === 'remove' && error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="button-row modal-actions">
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setMode('view')}>Cancel</button>
          <button
            type="button"
            className="btn btn-small btn-danger"
            disabled={busy}
            onClick={() => {
              setError(null)
              start(async () => {
                const result = await removeCashFlow({ cashFlowId: selected.id })
                if (!result.ok) {
                  setError(result.error)
                  return
                }
                setMode('view')
                setDone(result.message)
                // Back to the tab without the deleted statement in the address, then load what is left.
                router.replace(`/dashboard/assets/${assetId}?screen=_cashflow`)
                router.refresh()
              })
            }}
          >
            {busy ? 'Deleting…' : 'Yes, Delete Cash Flow'}
          </button>
        </div>
      </Modal>
      {mode !== 'remove' && error ? <p className="form-error" role="alert">{error}</p> : null}
      {done ? <p className="form-ok" role="status">{done}</p> : null}

      <p className="note">
        {selected.documentName ? (
          <>
            From{' '}
            {selected.documentId ? <a href={`/dashboard/assets/${assetId}/documents/${selected.documentId}`}>{selected.documentName}</a> : <>{selected.documentName} (the document has since been removed)</>}.{' '}
          </>
        ) : null}
        {selected.basis ? `${selected.basis} basis. ` : null}
        The lines are copied as the document shows them.
      </p>

      {tiles.length > 0 ? (
        <>
          <div className="field-list tiles rent-roll-tiles">
            {tiles.map((tile) => (
              <div key={tile.label} className="field-card rent-roll-tile">
                <span className="field-card-label">{tile.label}</span>
                <span className="field-card-value">{tile.value}</span>
                {tile.sub ? <span className="cash-flow-tile-sub">{tile.sub}</span> : null}
              </div>
            ))}
          </div>
          <p className="doc-sub">{covers}{mixed && totals ? ` Only the ${CASH_FLOW_COLUMN_LABELS[totals.kind].toLowerCase()} columns are counted.` : ''}</p>
        </>
      ) : null}
      {checks.length > 0 ? (
        <p className="note" role="status">
          The document&apos;s own totals are shown. In {checks.length === 1 ? 'one place' : `${checks.length} places`} the lines marked as items do not add up to them
          {' '}(for example {checks[0].what === 'income' ? 'income' : 'operating expenses'} for {checks[0].column}: the document shows {figure(checks[0].shown, cents)}, the items add up to {figure(checks[0].added, cents)}),
          so a line may be marked as an item that the document counts as a subtotal, or the other way round. How lines are marked is set by the Reading an Operating Statement skill in the Skills Library.
        </p>
      ) : null}
      {selected.notes ? <p className="note"><strong>From the reading:</strong> {selected.notes}</p> : null}

      <div className="cash-flow-view">
        <div className="map-tabs" role="tablist" aria-label="How the statement is shown">
          <button type="button" role="tab" aria-selected={view === 'lines'} className={`map-tab${view === 'lines' ? ' active' : ''}`} onClick={() => setView('lines')}>Lines as Shown</button>
          <button type="button" role="tab" aria-selected={view === 'categories'} className={`map-tab${view === 'categories' ? ' active' : ''}`} onClick={() => setView('categories')}>By Category</button>
        </div>
        {view === 'categories' ? <span className="doc-sub">Item lines added up under the categories the Reading an Operating Statement skill lists.</span> : null}
        <button type="button" className="icon-button grid-search-button cash-flow-download" aria-label="Download to Excel" title="Download to Excel" onClick={download}>
          <DownloadIcon />
        </button>
      </div>

      <ScrollBox className="table-scroll cash-flow-scroll">
        <table className="cash-flow-table">
          {head}
          {view === 'lines' ? (
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={columns.length + 1}>This statement has no lines.</td></tr>
              ) : (
                lines.map((line) =>
                  line.kind === 'heading' ? (
                    <tr key={line.id} className="cash-flow-heading">
                      <th scope="row" colSpan={columns.length + 1}><span className="cash-flow-heading-text" style={{ left: 10 + line.indent * 14 }}>{line.code ? <span className="cash-flow-code">{line.code}</span> : null}{line.name}</span></th>
                    </tr>
                  ) : (
                    <tr key={line.id} className={line.kind === 'item' ? undefined : line.kind === 'noi' ? 'cash-flow-noi' : 'cash-flow-sum'}>
                      <th scope="row" style={{ paddingLeft: 10 + line.indent * 14 }} title={line.kind === 'item' && line.category ? `Category: ${line.category}` : undefined}>
                        {line.code ? <span className="cash-flow-code">{line.code}</span> : null}
                        {line.name}
                      </th>
                      {amountCells(line.amounts)}
                    </tr>
                  ),
                )
              )}
            </tbody>
          ) : (
            <tbody>
              {CASH_FLOW_SECTIONS.flatMap((section) => {
                const rows = categories.filter((row) => row.section === section)
                if (rows.length === 0) return []
                return [
                  sectionRow(section),
                  ...rows.map((row) => (
                    <tr key={`${section}-${row.category}`}>
                      <th scope="row" style={{ paddingLeft: 24 }}>{row.category}</th>
                      {amountCells(row.amounts)}
                    </tr>
                  )),
                  section === 'income' ? totalRow('income') : section === 'expense' ? totalRow('expenses') : null,
                  section === 'expense' ? totalRow('noi') : null,
                ]
              })}
            </tbody>
          )}
        </table>
      </ScrollBox>
      {view === 'categories' && uncategorized ? <p className="doc-sub">Lines the reading gave no category are under Not Categorized.</p> : null}
      {view === 'categories' ? <p className="doc-sub">Total Income, Total Operating Expenses and Net Operating Income are the document&apos;s own lines where it shows them.</p> : null}
    </section>
  )
}
