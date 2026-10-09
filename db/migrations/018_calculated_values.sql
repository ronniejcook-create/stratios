-- Stage 5, first part: values the agent calculates when a document is read.
-- Run after 017_more_standard_fields.sql. Safe to run more than once.
--
-- How it works: a document being read is the trigger. A skill that fits the
-- document (for example "Reading a Rent Roll") says WHICH values to
-- calculate. Each field's Agent Instructions holds HOW, under the heading
-- "How to Calculate". A figure the document itself shows is always taken as
-- shown; the agent calculates only what the document leaves out.
--
-- 1. The review list remembers whether a value was shown in the document or
--    calculated by the agent.
-- 2. "How to Calculate" recipes are added to ten standard fields.
-- 3. Two standard skills are added: Reading a Rent Roll and Reading an
--    Operating Statement.

begin;

alter table document_findings add column if not exists basis text check (basis in ('stated', 'calculated'));

alter table field_definitions no force row level security;
alter table skills no force row level security;

-- 2. Recipes. Added once, to the end of the field's instructions; a field that
--    already has a "How to Calculate" part is left alone.
update field_definitions f
set agent_instructions = coalesce(nullif(trim(f.agent_instructions), '') || E'\n\n', '') || E'### How to Calculate\n' || r.recipe
from (values
  ('property', 'occupancyRate',
   E'Use only when the document does not show the figure.\n\nOccupied rentable square feet divided by total rentable square feet, times 100, as of the document''s date. A suite is occupied when a tenant is in place on that date; space that is leased but not yet started is not occupied. Round to one decimal.'),
  ('property', 'percentLeased',
   E'Use only when the document does not show the figure.\n\nRentable square feet under a signed lease (including leases that have not started yet) divided by total rentable square feet, times 100. Round to one decimal.'),
  ('property', 'numberOfTenants',
   E'Use only when the document does not show the figure.\n\nCount the different tenant names with a lease in place. A tenant in several suites counts once. Vacant suites are not counted.'),
  ('property', 'weightedAverageLeaseTerm',
   E'Use only when the document does not show the figure.\n\nFor each leased suite, take the years from the document''s date to the lease expiration (month-to-month counts as zero) and multiply by the suite''s rentable square feet. Add these up and divide by the total leased square feet. Round to one decimal.'),
  ('property', 'averageRentPerSquareFoot',
   E'Use only when the document does not show the figure.\n\nTotal annual base rent of the occupied suites divided by their rentable square feet. If the document shows monthly rent, multiply by 12 first. Round to two decimals.'),
  ('property', 'totalRentableSquareFeet',
   E'Use only when the document does not show a total.\n\nAdd up the rentable square feet of every suite, occupied and vacant.'),
  ('property', 'netOperatingIncome',
   E'Use only when the document does not show Net Operating Income for the month.\n\nTotal Revenue minus Operating Expenses for the same month. Operating Expenses leave out debt payments, depreciation and capital spending.'),
  ('property', 'goingInCapRate',
   E'Use only when the document does not show a cap rate.\n\nIn-place annual Net Operating Income divided by the Purchase Price, times 100. Round to two decimals. Never use an asking price as the Purchase Price.'),
  ('property', 'debtServiceCoverageRatio',
   E'Use only when the document does not show the ratio.\n\nNet Operating Income divided by Debt Service for the same month. Round to two decimals.'),
  ('property', 'loanToValue',
   E'Use only when the document does not show the figure.\n\nLoan Balance divided by Current Value, times 100, for the same month. Round to one decimal.')
) as r (applies_to, key, recipe)
where f.org_id is null and f.applies_to = r.applies_to and f.key = r.key
  and position('### How to Calculate' in coalesce(f.agent_instructions, '')) = 0;

-- 3. Skills: which values to calculate for which kind of document.
insert into skills (key, name, use_when, instructions, created_by, updated_by)
select v.key, v.name, v.use_when, v.instructions, 'stratios', 'stratios'
from (values
  ('reading-a-rent-roll', 'Reading a Rent Roll',
   'The document is a rent roll: a list of a property''s suites or units with their tenants, areas, rents and lease dates.',
   E'### What This Document Is\nA snapshot of who leases what on one date (the "as of" date). Use that date''s month for every value tracked per month.\n\n### Rules\n- Where the rent roll shows a total or summary figure (total square feet, occupancy, number of tenants), take it exactly as shown.\n- Do not return tenant-by-tenant or suite-by-suite figures as field values.\n- Add a critical date for each lease expiration in the next 24 months, naming the tenant and the suite.\n\n### Values to Calculate\nWhen the rent roll does not show them, calculate these from its rows, each by its field''s "How to Calculate":\n- Occupancy Rate\n- Percent Leased\n- Number of Tenants\n- Weighted Average Lease Term\n- Average Rent per Square Foot\n- Total Rentable Square Feet\n\n### What to Mention in the Summary\n- The as of date, and which values were calculated rather than shown.\n- Anything that made a calculation uncertain, such as missing areas or lease dates.'),
  ('reading-an-operating-statement', 'Reading an Operating Statement',
   'The document is an operating statement, income statement, profit and loss report or trailing-twelve-month report for a property.',
   E'### What This Document Is\nThe property''s actual income and expenses, usually one column per month.\n\n### Rules\n- Take Total Revenue, Operating Expenses and Net Operating Income for each month exactly as shown, one value per month.\n- Use actual figures, not budget or variance columns.\n- A column of totals for the year is not a month; leave it out.\n\n### Values to Calculate\nWhen the statement does not show it, calculate this for each month by its field''s "How to Calculate":\n- Net Operating Income\n\n### What to Mention in the Summary\n- The months covered, and whether Net Operating Income was shown or calculated.')
) as v (key, name, use_when, instructions)
where not exists (select 1 from skills s where s.org_id is null and s.key = v.key);

alter table field_definitions force row level security;
alter table skills force row level security;

commit;
