-- The skills library: named, plain-English know-how the agents pick from,
-- such as how to read an Offering Memorandum versus an appraisal.
-- Run after 010_analyst_instructions.sql. Safe to run more than once.
--
-- A skill has a name, a line saying when to use it, and its instructions.
-- Stratios administrators manage the library on Stratios Admin > Skills
-- Library, and it applies to every organization. org_id is always null today;
-- the column is there so an organization can have its own skills later, the
-- way it can have its own fields.

do $$
declare
  first_run boolean;
begin
  select not exists (select 1 from information_schema.tables where table_schema = current_schema() and table_name = 'skills') into first_run;

  create table if not exists skills (
    id            uuid primary key default gen_random_uuid(),
    org_id        text,
    key           text not null,
    name          text not null check (length(trim(name)) > 0),
    use_when      text not null,
    instructions  text not null,
    enabled       boolean not null default true,
    created_by    text not null,
    created_at    timestamptz not null default now(),
    updated_by    text not null,
    updated_at    timestamptz not null default now()
  );
  create unique index if not exists skills_key_idx on skills (coalesce(org_id, ''), key);

  -- Two starter skills, added only when the library is first created, so
  -- skills that were edited or removed since are never put back.
  if first_run then
    insert into skills (key, name, use_when, instructions, created_by, updated_by) values
    ('reading-an-offering-memorandum', 'Reading an Offering Memorandum',
     'The document is an Offering Memorandum (OM), sales brochure or other marketing package for a property that is for sale.',
     E'### What This Document Is\nA seller''s marketing package. It describes the property well, but its financial figures are the seller''s presentation and are often projections.\n\n### Rules\n- The asking price or offering price is **not** the Purchase Price. Fill in Purchase Price only when the document states what the current owner actually paid.\n- Prefer in-place or trailing-twelve-month figures over pro forma or projected ones. If only pro forma figures are given, return them with low confidence and say so in the summary.\n- Take building facts (year built, year renovated, floors, rentable square feet, parking, land area) from the property summary or property description pages.\n- Occupancy is usually stated as of a date. Use that month.\n- Market and submarket are usually named in the location or market overview section.\n\n### What to Mention in the Summary\n- Whether the figures are actual or pro forma.\n- Anything the seller flags as an assumption.',
     'stratios', 'stratios'),
    ('reading-an-appraisal', 'Reading an Appraisal',
     'The document is an appraisal or valuation report.',
     E'### What This Document Is\nAn independent opinion of value as of a stated date.\n\n### Rules\n- The appraised value goes in Current Value, and its effective date (the "as of" date) goes in Valuation Date. Use the "as is" value, not the "as stabilized" or "as complete" value, unless only one is given.\n- If several approaches give different values, use the final reconciled value.\n- Do not fill in Purchase Price from an appraisal unless it reports the actual sale of this property.\n\n### What to Mention in the Summary\n- Which value was used (as is, as stabilized) and its effective date.',
     'stratios', 'stratios');
  end if;
end $$;

alter table skills enable row level security;
alter table skills force row level security;

-- Everyone reads the standard skills (and, later, their own organization's).
drop policy if exists skills_read on skills;
create policy skills_read on skills for select
  using (org_id is null or org_id = current_setting('app.org_id', true));

-- Only Stratios administrators change the standard skills.
drop policy if exists skills_stratios_admin on skills;
create policy skills_stratios_admin on skills for all
  using (org_id is null and current_setting('app.stratios_admin', true) = 'on')
  with check (org_id is null and current_setting('app.stratios_admin', true) = 'on');
