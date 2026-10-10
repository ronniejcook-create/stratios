// Cash flows: an operating statement (for example a trailing twelve months)
// kept line by line and month by month, as its document shows it. Each
// statement that is loaded is its own copy; an earlier one is never changed
// by a later one.
//
// Every function that takes a client takes the database client of a
// transaction scoped to one organization (see withOrg in lib/db.ts). The
// types and the sums at the end are plain, and safe to use in the browser.

import type { Queryable } from './records'

export type CashFlowSection = 'income' | 'expense' | 'other'
export const CASH_FLOW_SECTIONS: readonly CashFlowSection[] = ['income', 'expense', 'other']
export const CASH_FLOW_SECTION_LABELS: Record<CashFlowSection, string> = { income: 'Income', expense: 'Operating Expenses', other: 'Below Net Operating Income' }

/**
 * What a line is. A heading has no figures; an item is one account or line;
 * a subtotal or total is a sum the document shows. Three totals are marked,
 * because the screens show them first: total income, total operating
 * expenses and net operating income.
 */
export type CashFlowLineKind = 'heading' | 'item' | 'subtotal' | 'total' | 'total_income' | 'total_expenses' | 'noi'
export const CASH_FLOW_LINE_KINDS: readonly CashFlowLineKind[] = ['heading', 'item', 'subtotal', 'total', 'total_income', 'total_expenses', 'noi']

export type CashFlowColumnKind = 'actual' | 'budget' | 'forecast'
export const CASH_FLOW_COLUMN_KINDS: readonly CashFlowColumnKind[] = ['actual', 'budget', 'forecast']
export const CASH_FLOW_COLUMN_LABELS: Record<CashFlowColumnKind, string> = { actual: 'Actual', budget: 'Budget', forecast: 'Forecast' }

/** One column of a statement: a month, or a longer period such as a year or the total of the months beside it. */
export type CashFlowColumn = {
  /** The heading as the document writes it. */
  label: string
  /** The first month the column covers, YYYY-MM. */
  start: string
  /** How many months it covers: 1 for a month, 12 for a year. */
  months: number
  kind: CashFlowColumnKind
  /** True when the column adds up other columns of the statement (the total beside twelve months). */
  total: boolean
}

export type CashFlowLineInput = {
  name: string
  code: string | null
  section: CashFlowSection
  kind: CashFlowLineKind
  category: string | null
  indent: number
  /** One amount per column, in the columns' order; null where the document shows nothing. */
  amounts: (number | null)[]
}

export type CashFlowInput = {
  assetId: string
  propertyId: string
  document: { id: string; name: string } | null
  title: string | null
  basis: string | null
  columns: CashFlowColumn[]
  lines: CashFlowLineInput[]
  notes: string | null
}

/** "2025-03" plus a number of months, as YYYY-MM. */
export function addMonths(month: string, count: number): string {
  const [year, index] = month.split('-').map(Number)
  const moved = new Date(Date.UTC(year, index - 1 + count, 1))
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The last month a column covers, YYYY-MM. */
export const lastMonthOf = (column: Pick<CashFlowColumn, 'start' | 'months'>) => addMonths(column.start, column.months - 1)

/** The months between two YYYY-MM months, both counted. */
export function monthsBetween(first: string, last: string): number {
  const [firstYear, firstMonth] = first.split('-').map(Number)
  const [lastYear, lastMonth] = last.split('-').map(Number)
  return (lastYear - firstYear) * 12 + (lastMonth - firstMonth) + 1
}

/**
 * Marks the columns that add up others: a column covering more than a month
 * is a total when at least two shorter columns of the same kind lie inside
 * it. Pure.
 */
export function markTotals(columns: Omit<CashFlowColumn, 'total'>[]): CashFlowColumn[] {
  return columns.map((column, index) => {
    const last = lastMonthOf(column)
    const inside = columns.filter(
      (other, otherIndex) => otherIndex !== index && other.kind === column.kind && other.months < column.months && other.start >= column.start && lastMonthOf(other) <= last,
    )
    return { ...column, total: column.months > 1 && inside.length >= 2 }
  })
}

/** Whether the tables are there (migration 030). */
export async function cashFlowsReady(client: Queryable): Promise<boolean> {
  const { rows } = await client.query(`select to_regclass(current_schema() || '.cash_flow_amounts') is not null as ready`)
  return rows[0]?.ready === true
}

/**
 * Saves a statement and returns its id. If the same document was saved
 * before, that statement is replaced, so reading a document again never
 * leaves two copies.
 */
export async function saveCashFlow(client: Queryable, orgId: string, userId: string, input: CashFlowInput): Promise<string> {
  if (input.columns.length === 0) throw new Error('A cash flow needs at least one column')
  if (input.document) await client.query('delete from cash_flows where org_id = $1 and document_id = $2', [orgId, input.document.id])
  const first = input.columns.reduce((earliest, column) => (column.start < earliest ? column.start : earliest), input.columns[0].start)
  const last = input.columns.reduce((latest, column) => (lastMonthOf(column) > latest ? lastMonthOf(column) : latest), lastMonthOf(input.columns[0]))
  const created = await client.query(
    `insert into cash_flows (org_id, asset_id, property_id, document_id, document_name, title, basis, period_start, period_end, columns, notes, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8::date, ($9::date + interval '1 month' - interval '1 day')::date, $10::jsonb, $11, $12)
     returning id::text as id`,
    [
      orgId, input.assetId, input.propertyId, input.document?.id ?? null, input.document?.name.slice(0, 200) ?? null,
      input.title?.slice(0, 200) ?? null, input.basis?.slice(0, 60) ?? null, `${first}-01`, `${last}-01`, JSON.stringify(input.columns), input.notes?.slice(0, 2000) ?? null, userId,
    ],
  )
  const id = created.rows[0].id as string

  // Lines go in a few at a time, as one statement each time; their ids come back in the same order.
  const lineIds: string[] = []
  const LINE_BATCH = 60
  for (let start = 0; start < input.lines.length; start += LINE_BATCH) {
    const batch = input.lines.slice(start, start + LINE_BATCH)
    const values: unknown[] = []
    const groups = batch.map((line, index) => {
      values.push(orgId, id, start + index + 1, line.name.slice(0, 300), line.code?.slice(0, 60) ?? null, line.section, line.kind, line.category?.slice(0, 100) ?? null, Math.max(0, Math.min(6, Math.round(line.indent) || 0)))
      const at = index * 9
      return `($${at + 1}, $${at + 2}::uuid, $${at + 3}, $${at + 4}, $${at + 5}, $${at + 6}, $${at + 7}, $${at + 8}, $${at + 9})`
    })
    const { rows } = await client.query(
      `insert into cash_flow_lines (org_id, cash_flow_id, position, name, code, section, kind, category, indent)
       values ${groups.join(', ')}
       returning id::text as id, position`,
      values,
    )
    const byPosition = new Map<number, string>(rows.map((row) => [Number(row.position), String(row.id)]))
    for (let index = 0; index < batch.length; index += 1) lineIds.push(byPosition.get(start + index + 1) as string)
  }

  const cells: { lineId: string; column: number; amount: number }[] = []
  input.lines.forEach((line, lineIndex) => {
    line.amounts.slice(0, input.columns.length).forEach((amount, column) => {
      if (amount !== null && Number.isFinite(amount)) cells.push({ lineId: lineIds[lineIndex], column, amount })
    })
  })
  const CELL_BATCH = 400
  for (let start = 0; start < cells.length; start += CELL_BATCH) {
    const batch = cells.slice(start, start + CELL_BATCH)
    const values: unknown[] = []
    const groups = batch.map((cell, index) => {
      const column = input.columns[cell.column]
      values.push(orgId, id, cell.lineId, cell.column, `${column.start}-01`, column.months, column.kind, column.total, cell.amount)
      const at = index * 9
      return `($${at + 1}, $${at + 2}::uuid, $${at + 3}::uuid, $${at + 4}, $${at + 5}::date, $${at + 6}, $${at + 7}, $${at + 8}::boolean, $${at + 9}::numeric)`
    })
    await client.query(
      `insert into cash_flow_amounts (org_id, cash_flow_id, line_id, column_index, period_start, period_months, kind, is_total, amount)
       values ${groups.join(', ')}`,
      values,
    )
  }
  return id
}

export type CashFlowHeader = {
  id: string
  assetId: string
  propertyId: string
  documentId: string | null
  documentName: string | null
  title: string | null
  basis: string | null
  /** The first day of the first month, and the last day of the last month, the statement covers. */
  periodStart: string
  periodEnd: string
  columns: CashFlowColumn[]
  notes: string | null
  lineCount: number
  createdBy: string
  createdAt: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toColumns(raw: any): CashFlowColumn[] {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((entry) => {
    const start = String(entry?.start ?? '')
    const months = Number(entry?.months)
    if (!/^\d{4}-\d{2}$/.test(start) || !Number.isInteger(months) || months < 1) return []
    const kind = CASH_FLOW_COLUMN_KINDS.find((choice) => choice === entry?.kind) ?? 'actual'
    return [{ label: String(entry?.label ?? ''), start, months, kind, total: entry?.total === true }]
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toHeader(row: any): CashFlowHeader {
  return {
    id: row.id,
    assetId: row.asset_id,
    propertyId: row.property_id,
    documentId: row.document_id ?? null,
    documentName: row.document_name ?? null,
    title: row.title ?? null,
    basis: row.basis ?? null,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    columns: toColumns(row.columns),
    notes: row.notes ?? null,
    lineCount: Number(row.line_count),
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

const HEADER_COLUMNS = `c.id::text as id, c.asset_id::text as asset_id, c.property_id::text as property_id, c.document_id::text as document_id,
  c.document_name, c.title, c.basis, c.period_start::text as period_start, c.period_end::text as period_end, c.columns, c.notes,
  (select count(*)::int from cash_flow_lines l where l.cash_flow_id = c.id) as line_count, c.created_by,
  to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at`

/** An asset's statements, the latest period first; for one period, the one loaded last first. */
export async function listCashFlows(client: Queryable, orgId: string, assetId: string): Promise<CashFlowHeader[]> {
  const { rows } = await client.query(
    `select ${HEADER_COLUMNS} from cash_flows c where c.org_id = $1 and c.asset_id = $2 order by c.period_end desc, c.period_start desc, c.created_at desc`,
    [orgId, assetId],
  )
  return rows.map(toHeader)
}

export async function getCashFlow(client: Queryable, orgId: string, cashFlowId: string): Promise<CashFlowHeader | null> {
  const { rows } = await client.query(`select ${HEADER_COLUMNS} from cash_flows c where c.org_id = $1 and c.id = $2`, [orgId, cashFlowId])
  return rows[0] ? toHeader(rows[0]) : null
}

/** The statement a document was saved as, if it held one. Null also before migration 030 is run, without spoiling the transaction it runs in. */
export async function cashFlowOfDocument(client: Queryable, orgId: string, documentId: string): Promise<CashFlowHeader | null> {
  try {
    await client.query('savepoint cash_flow_lookup')
  } catch {
    return null
  }
  try {
    const { rows } = await client.query(`select ${HEADER_COLUMNS} from cash_flows c where c.org_id = $1 and c.document_id = $2 limit 1`, [orgId, documentId])
    await client.query('release savepoint cash_flow_lookup')
    return rows[0] ? toHeader(rows[0]) : null
  } catch {
    await client.query('rollback to savepoint cash_flow_lookup').catch(() => {})
    return null
  }
}

export type CashFlowLine = CashFlowLineInput & { id: string; position: number }

/** The lines of one statement in the document's order, each with one amount per column (`columnCount` of them). */
export async function listCashFlowLines(client: Queryable, orgId: string, cashFlowId: string, columnCount: number): Promise<CashFlowLine[]> {
  const { rows } = await client.query(
    `select l.id::text as id, l.position, l.name, l.code, l.section, l.kind, l.category, l.indent,
            coalesce((select jsonb_object_agg(a.column_index::text, a.amount::float8) from cash_flow_amounts a where a.line_id = l.id), '{}'::jsonb) as amounts
     from cash_flow_lines l
     where l.org_id = $1 and l.cash_flow_id = $2
     order by l.position`,
    [orgId, cashFlowId],
  )
  return rows.map((row) => {
    const held = (typeof row.amounts === 'string' ? JSON.parse(row.amounts) : row.amounts ?? {}) as Record<string, unknown>
    const amounts: (number | null)[] = []
    for (let index = 0; index < columnCount; index += 1) {
      const value = held[String(index)]
      amounts.push(value === null || value === undefined ? null : Number(value))
    }
    return {
      id: row.id,
      position: Number(row.position),
      name: row.name,
      code: row.code ?? null,
      section: row.section,
      kind: row.kind,
      category: row.category ?? null,
      indent: Number(row.indent) || 0,
      amounts,
    }
  })
}

/** Removes a statement with its lines and amounts. False when it isn't this organization's. */
export async function deleteCashFlow(client: Queryable, orgId: string, cashFlowId: string): Promise<boolean> {
  const { rows } = await client.query('delete from cash_flows where org_id = $1 and id = $2 returning id::text as id', [orgId, cashFlowId])
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Sums. Pure, and safe to use in the browser.
// ---------------------------------------------------------------------------

type SummedLine = Pick<CashFlowLineInput, 'section' | 'kind' | 'amounts'>

/** One of the three headline figures for one column: the figure, and whether the document shows it or the lines were added up. */
export type CashFlowFigure = { amount: number | null; stated: boolean }

export type CashFlowColumnSums = {
  income: CashFlowFigure
  expenses: CashFlowFigure
  noi: CashFlowFigure
  /** The income and expense item lines added up, to check against the document's own totals. */
  addedIncome: number | null
  addedExpenses: number | null
}

const sumOf = (lines: SummedLine[], column: number): number | null => {
  const amounts = lines.map((line) => line.amounts[column]).filter((amount): amount is number => amount !== null && amount !== undefined)
  return amounts.length > 0 ? amounts.reduce((sum, amount) => sum + amount, 0) : null
}

/**
 * Income, operating expenses and net operating income for each column. The
 * document's own total lines are used wherever it shows them, so the figures
 * match the page; where it shows none, the item lines are added up (expenses
 * taken as positive figures, as statements print them).
 */
export function columnSums(lines: SummedLine[], columnCount: number): CashFlowColumnSums[] {
  const marked = (kind: CashFlowLineKind) => lines.filter((line) => line.kind === kind)
  // A statement can show a marked total more than once (a summary page and the detail); the last one is the final figure.
  const statedIn = (kind: CashFlowLineKind, column: number): number | null => {
    const found = marked(kind).map((line) => line.amounts[column]).filter((amount): amount is number => amount !== null && amount !== undefined)
    return found.length > 0 ? found[found.length - 1] : null
  }
  const items = (section: CashFlowSection) => lines.filter((line) => line.kind === 'item' && line.section === section)
  const result: CashFlowColumnSums[] = []
  for (let column = 0; column < columnCount; column += 1) {
    const addedIncome = sumOf(items('income'), column)
    const addedExpenses = sumOf(items('expense'), column)
    const statedIncome = statedIn('total_income', column)
    const statedExpenses = statedIn('total_expenses', column)
    const statedNoi = statedIn('noi', column)
    const income = statedIncome ?? addedIncome
    const expenses = statedExpenses ?? addedExpenses
    result.push({
      income: { amount: income, stated: statedIncome !== null },
      expenses: { amount: expenses, stated: statedExpenses !== null },
      noi: { amount: statedNoi ?? (income !== null && expenses !== null ? income - expenses : null), stated: statedNoi !== null },
      addedIncome,
      addedExpenses,
    })
  }
  return result
}

export type CashFlowTotals = {
  income: CashFlowFigure
  expenses: CashFlowFigure
  noi: CashFlowFigure
  /** The months the figures cover. */
  months: number
  /** Where they came from: the document's own total column, its month columns added up, or its latest column alone. */
  from: 'total' | 'months' | 'column'
  /** The heading of the column used, for 'total' and 'column'. */
  label: string | null
  kind: CashFlowColumnKind
}

/**
 * The statement's headline figures. The document's own total column is used
 * when it has one. Otherwise month columns are added up; and when the
 * columns are longer periods side by side (three years, say), the latest one
 * is shown alone, since adding years together means nothing. A statement
 * that mixes actual and budget columns is summed for the kind it has the
 * most months of, actual first. Null when there is nothing to sum.
 */
export function periodTotals(columns: CashFlowColumn[], lines: SummedLine[]): CashFlowTotals | null {
  if (columns.length === 0) return null
  const sums = columnSums(lines, columns.length)
  const monthsOf = (kind: CashFlowColumnKind) => columns.filter((column) => column.kind === kind && !column.total).reduce((sum, column) => sum + column.months, 0)
  const kind = [...CASH_FLOW_COLUMN_KINDS].sort((a, b) => monthsOf(b) - monthsOf(a))[0]
  const ofKind = columns.map((column, index) => ({ column, index })).filter((entry) => entry.column.kind === kind)
  const parts = ofKind.filter((entry) => !entry.column.total)
  // The widest total column is the statement's own figure for the period.
  const widest = ofKind.filter((entry) => entry.column.total).sort((a, b) => b.column.months - a.column.months)[0]
  if (widest && sums[widest.index].noi.amount !== null) {
    const { income, expenses, noi } = sums[widest.index]
    return { income, expenses, noi, months: widest.column.months, from: 'total', label: widest.column.label, kind }
  }
  if (parts.length === 0) return null
  if (parts.some((entry) => entry.column.months > 1)) {
    const latest = parts.reduce((best, entry) => (lastMonthOf(entry.column) >= lastMonthOf(best.column) ? entry : best), parts[0])
    const { income, expenses, noi } = sums[latest.index]
    return { income, expenses, noi, months: latest.column.months, from: 'column', label: latest.column.label, kind }
  }
  const add = (pick: (sum: CashFlowColumnSums) => CashFlowFigure): CashFlowFigure => {
    const known = parts.map((entry) => pick(sums[entry.index])).filter((figure) => figure.amount !== null)
    return { amount: known.length > 0 ? known.reduce((sum, figure) => sum + (figure.amount as number), 0) : null, stated: known.length > 0 && known.every((figure) => figure.stated) }
  }
  return { income: add((sum) => sum.income), expenses: add((sum) => sum.expenses), noi: add((sum) => sum.noi), months: parts.length, from: 'months', label: null, kind }
}

export type CashFlowCheck = { what: 'income' | 'expenses'; column: string; shown: number; added: number }

/**
 * Where the item lines of a part do not add up to the total the document
 * shows for it, column by column. A difference of less than a dollar a line
 * is rounding and is left out. The document's figure is the one shown.
 */
export function checkTotals(columns: CashFlowColumn[], lines: SummedLine[]): CashFlowCheck[] {
  const sums = columnSums(lines, columns.length)
  const allowed = Math.max(2, lines.filter((line) => line.kind === 'item').length)
  const checks: CashFlowCheck[] = []
  sums.forEach((sum, index) => {
    if (sum.income.stated && sum.addedIncome !== null && Math.abs((sum.income.amount as number) - sum.addedIncome) > allowed) {
      checks.push({ what: 'income', column: columns[index].label, shown: sum.income.amount as number, added: sum.addedIncome })
    }
    if (sum.expenses.stated && sum.addedExpenses !== null && Math.abs((sum.expenses.amount as number) - sum.addedExpenses) > allowed) {
      checks.push({ what: 'expenses', column: columns[index].label, shown: sum.expenses.amount as number, added: sum.addedExpenses })
    }
  })
  return checks
}

export type CategoryRow = { section: CashFlowSection; category: string; amounts: (number | null)[] }

/** The item lines added up by category within each part, in the order the categories first appear. */
export function byCategory(lines: Pick<CashFlowLineInput, 'section' | 'kind' | 'category' | 'amounts'>[], columnCount: number): CategoryRow[] {
  const rows = new Map<string, CategoryRow>()
  for (const line of lines) {
    if (line.kind !== 'item') continue
    const category = line.category?.trim() || 'Not Categorized'
    const key = `${line.section}:${category.toLowerCase()}`
    const row = rows.get(key) ?? { section: line.section, category, amounts: Array.from({ length: columnCount }, () => null as number | null) }
    for (let column = 0; column < columnCount; column += 1) {
      const amount = line.amounts[column]
      if (amount !== null && amount !== undefined) row.amounts[column] = (row.amounts[column] ?? 0) + amount
    }
    rows.set(key, row)
  }
  return CASH_FLOW_SECTIONS.flatMap((section) => [...rows.values()].filter((row) => row.section === section))
}

/** "2025-01" -> "Jan 2025". */
export function monthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? month : date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** The months a statement covers, in words: "Jan 2025 to Dec 2025". Takes the stored first and last days. */
export function periodLabel(periodStart: string, periodEnd: string): string {
  const first = monthLabel(periodStart.slice(0, 7))
  const last = monthLabel(periodEnd.slice(0, 7))
  return first === last ? first : `${first} to ${last}`
}
