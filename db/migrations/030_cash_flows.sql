-- Cash flows: an operating statement (for example a trailing twelve months)
-- kept line by line, month by month, as the document shows it.
-- Run after 029_lease_expiration_rule.sql. Safe to run more than once.
--
-- Like a rent roll, each statement that is loaded is kept as its own copy
-- of the document: a later one never changes an earlier one. A statement
-- belongs to one property of one asset and usually came from a document.
-- Removing the document keeps the statement; deleting the asset deletes it.
--
-- 1. cash_flows: one row per statement, with its columns (the months).
-- 2. cash_flow_lines: its lines in the document's order.
-- 3. cash_flow_amounts: one row per line and column.
-- 4. The standard "Reading an Operating Statement" skill gains the rules for
--    copying the statement: which columns, what each line is, and the
--    categories lines are grouped under. An organization's edited copy is
--    not touched.

begin;

create table if not exists cash_flows (
  id             uuid primary key default gen_random_uuid(),
  org_id         text not null,
  asset_id       uuid not null references assets (id) on delete cascade,
  property_id    uuid not null references properties (id) on delete cascade,
  document_id    uuid references documents (id) on delete set null,
  document_name  text,
  -- The statement's title as the document writes it.
  title          text,
  -- Accrual or cash, when the document says.
  basis          text,
  -- The first day of the first month and the last day of the last month the columns cover.
  period_start   date not null,
  period_end     date not null,
  -- The columns in the document's order:
  -- [{"label": "Jan 2025", "start": "2025-01", "months": 1, "kind": "actual", "total": false}]
  columns        jsonb not null default '[]'::jsonb,
  -- What the agent said about the statement: anything left out or unclear.
  notes          text,
  created_by     text not null,
  created_at     timestamptz not null default now()
);
create index if not exists cash_flows_asset_idx on cash_flows (org_id, asset_id, period_end desc);
create index if not exists cash_flows_document_idx on cash_flows (document_id);

create table if not exists cash_flow_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null,
  cash_flow_id  uuid not null references cash_flows (id) on delete cascade,
  position      int not null,
  -- The line's name and account number as the document writes them.
  name          text not null,
  code          text,
  -- income, expense, or other (below net operating income: capital, leasing costs, debt service).
  section       text not null check (section in ('income', 'expense', 'other')),
  -- heading: a title with no figures. item: one account or line. subtotal and total: sums the document shows.
  -- total_income, total_expenses and noi mark the three totals the screens show first.
  kind          text not null check (kind in ('heading', 'item', 'subtotal', 'total', 'total_income', 'total_expenses', 'noi')),
  -- The category the line is grouped under, from the skill's list (Base Rent, Utilities and so on).
  category      text,
  indent        int not null default 0
);
create index if not exists cash_flow_lines_flow_idx on cash_flow_lines (cash_flow_id, position);

create table if not exists cash_flow_amounts (
  org_id         text not null,
  cash_flow_id   uuid not null references cash_flows (id) on delete cascade,
  line_id        uuid not null references cash_flow_lines (id) on delete cascade,
  column_index   int not null,
  -- The first day of the first month the column covers, and how many months.
  period_start   date not null,
  period_months  int not null,
  kind           text not null check (kind in ('actual', 'budget', 'forecast')),
  -- True for a column that adds up other columns of the statement (a year's total beside its months).
  is_total       boolean not null default false,
  amount         numeric not null,
  primary key (line_id, column_index)
);
create index if not exists cash_flow_amounts_flow_idx on cash_flow_amounts (cash_flow_id);
create index if not exists cash_flow_amounts_period_idx on cash_flow_amounts (org_id, period_start);

do $$
declare
  t text;
begin
  foreach t in array array['cash_flows', 'cash_flow_lines', 'cash_flow_amounts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_org_isolation', t);
    execute format(
      'create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))',
      t || '_org_isolation', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The skill
-- ---------------------------------------------------------------------------

alter table skills no force row level security;

update skills
set use_when = 'The document is an operating statement, income statement, profit and loss report, trailing-twelve-month report or budget for a property, or contains one: a table of income and expenses by month or by year.',
    instructions = instructions || E'\n\n### Copying the Statement\nStratios also keeps the whole statement, line by line, as a cash flow. When you are asked to copy it:\n- Give one line for each row of the statement, in the document''s order: headings, line items, subtotals and totals.\n- Copy every figure exactly as shown. A figure in parentheses or with a minus sign is negative. Leave a cell empty when the document leaves it empty. Never work out a cell, and never fill in a total the document does not show.\n- Keep each line''s name as written, and its account number when the document shows one.\n- When the document holds more than one statement, copy the one with actual figures by month for the most recent period, and say in the notes what else was there.\n\n### Columns\n- Give one column for each month the statement shows, and one for each column that covers a longer period, such as a year or a total for the twelve months.\n- A trailing-twelve-month statement has twelve month columns and usually a total.\n- Mark each column actual, budget or forecast. A statement with no label is actual.\n- Leave out columns that are not amounts for a period: per square foot, per unit, percent of income, variance and notes.\n\n### What Each Line Is\n- **Income:** rent, recoveries, parking and other income, and the vacancy, credit loss and concessions taken off them.\n- **Expense:** the costs of operating the property, down to net operating income.\n- **Other:** everything below net operating income: capital expenditures, tenant improvements, leasing commissions, debt service, depreciation, amortization and owner items.\n- A **heading** is a title with no figures. An **item** is one account or line. A **subtotal** adds up the items above it.\n- Mark three totals when the statement shows them: **total income** (the last total of income before the expenses begin, often called Effective Gross Income, Total Revenue or Total Income), **total expenses** (Total Operating Expenses) and **net operating income**. Any other total, such as cash flow after debt service, is a plain total.\n\n### Categories\nGive each item the category it belongs under, so statements with different account names can be compared. Use these names:\n- Income: Base Rent; Expense Recoveries; Percentage Rent; Parking Income; Other Income; Vacancy and Credit Loss; Concessions.\n- Expenses: Real Estate Taxes; Insurance; Utilities; Repairs and Maintenance; Cleaning; Landscaping and Grounds; Security; Payroll; Management Fee; General and Administrative; Marketing; Other Operating Expenses.\n- Other: Capital Expenditures; Tenant Improvements; Leasing Commissions; Debt Service; Depreciation and Amortization; Other Non-Operating.\n\nWhen a line fits none of them, use the Other name of its part (Other Income, Other Operating Expenses, Other Non-Operating). Headings, subtotals and totals have no category.',
    updated_at = now()
where org_id is null and key = 'reading-an-operating-statement'
  and position('### Copying the Statement' in instructions) = 0;

alter table skills force row level security;

commit;
