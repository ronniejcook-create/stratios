-- KPIs calculated from the stored leases, by skills.
-- Run after 025_tenant_rules_in_skill.sql. Safe to run more than once.
--
-- How it works: when a rent roll has been loaded, or someone presses
-- Recalculate KPIs, the agent is given a property's active leases and its
-- latest rent roll and follows a skill. The skill says WHICH values to
-- calculate and HOW. There are two to start with, because the figures that
-- matter differ by kind of property:
--   - Calculating Commercial KPIs (office, industrial, retail and so on:
--     square feet, rent per square foot, lease term, rollover, tenant share)
--   - Calculating Residential KPIs (apartments and the like: units, occupancy
--     by unit, rent per unit)
-- An organization can edit either skill, or add its own, in its Skills Library.
--
-- 1. sections.shown_for: a section can be shown only for some property types.
-- 2. Two standard sections on Financials, Commercial Leasing and Residential
--    Leasing, with thirteen new standard fields between them.
-- 3. The two standard skills.
-- 4. The Reading a Rent Roll skill no longer calculates values while reading;
--    that now happens afterwards, from the stored leases.
-- 5. kpi_runs: a record of each calculation, with the working for each value.
-- 6. An organization's own copy of one of the new fields is moved onto the
--    standard field, as earlier migrations did.

begin;

alter table field_definitions no force row level security;
alter table sections no force row level security;
alter table section_fields no force row level security;
alter table field_values no force row level security;
alter table field_value_history no force row level security;
alter table field_source_values no force row level security;
alter table document_findings no force row level security;
alter table field_proposals no force row level security;
alter table field_permissions no force row level security;
alter table field_settings no force row level security;
alter table skills no force row level security;

-- ---------------------------------------------------------------------------
-- 1. Sections for some property types only
-- ---------------------------------------------------------------------------

-- A list of standard Property Type keys, for example ["residential", "seniorsHousing"].
-- Empty means every type. A type an organization added follows the standard
-- type it counts as. A property with no type, or a type that counts as
-- nothing standard, is shown every section.
alter table sections add column if not exists shown_for jsonb;

insert into sections (screen_id, key, name, applies_to, display_style, sort_order, shown_for)
select s.id, v.key, v.name, 'property', 'tiles', v.sort_order, v.shown_for::jsonb
from screens s
cross join (values
  ('commercialLeasing', 'Commercial Leasing', 22, '["office", "industrial", "retail", "hotel", "selfStorage", "mixedUse", "other"]'),
  ('residentialLeasing', 'Residential Leasing', 24, '["residential", "seniorsHousing"]')
) as v (key, name, sort_order, shown_for)
where s.org_id is null and s.key = 'financials'
on conflict ((coalesce(org_id, '')), applies_to, key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Fields
-- ---------------------------------------------------------------------------

insert into field_definitions
  (key, name, applies_to, data_type, unit, group_name, sort_order, calculated, ai_description, source_priority, when_different, agent_instructions)
values
  ('leasedSquareFeet', 'Leased Square Feet', 'property', 'number', 'SF', 'Commercial Leasing', 10, true,
   'Rentable square feet under lease on the date of the latest rent roll.',
   '{documents,calculated,manual}', 'ask',
   E'**Also called:** Leased SF, Leased Area, Occupied SF.\n\nFrom a document, take the leased total exactly as shown.\n\n### How to Calculate\nUse only when no document shows the figure. The rent roll''s own leased total when it states one; otherwise the square feet of the active leases added up. The KPI skill for the property''s kind may set this out in more detail; follow the skill.'),
  ('vacantSquareFeet', 'Vacant Square Feet', 'property', 'number', 'SF', 'Commercial Leasing', 20, true,
   'Rentable square feet available to lease on the date of the latest rent roll.',
   '{documents,calculated,manual}', 'ask',
   E'**Also called:** Vacant SF, Available SF, Available Vacant SF.\n\nFrom a document, take the vacant or available total exactly as shown. Space the document sets apart as not for lease (static) is not vacant.\n\n### How to Calculate\nUse only when no document shows the figure. The rent roll''s own vacant total when it states one; otherwise the square feet of the units marked Vacant added up. Follow the KPI skill where it says more.'),
  ('annualBaseRent', 'Annual Base Rent', 'property', 'money', 'USD', 'Commercial Leasing', 30, true,
   'The yearly base rent of the leases in place, before recoveries and other income.',
   '{documents,calculated,manual}', 'ask',
   E'**Also called:** In-Place Base Rent, Annual Rent, ABR, Base Rental Revenue.\n\nFrom a document, take the in-place annual base rent exactly as shown. Not pro forma or market rent, and not total revenue.\n\n### How to Calculate\nUse only when no document shows the figure. The annual rent of the active leases added up; where a lease shows only a monthly rent, twelve times that. Follow the KPI skill where it says more.'),
  ('leaseRolloverWithin12Months', 'Lease Rollover Within 12 Months', 'property', 'percent', null, 'Commercial Leasing', 40, true,
   'The share of leased square feet whose leases end within 12 months of the latest rent roll''s date.',
   '{calculated,documents,manual}', 'ask',
   E'**Also called:** Near-Term Rollover, 12-Month Expirations.\n\n### How to Calculate\nSquare feet of the active leases ending within 12 months after the rent roll''s date (leases already past their end date and month-to-month leases included), divided by the square feet of all active leases, times 100. One decimal. Follow the KPI skill where it says more.'),
  ('largestTenant', 'Largest Tenant', 'property', 'text', null, 'Commercial Leasing', 50, true,
   'The tenant paying the most annual base rent at the property.',
   '{calculated,documents,manual}', 'ask',
   E'**Also called:** Anchor Tenant, Top Tenant.\n\n### How to Calculate\nThe tenant whose active leases add up to the most annual base rent; by square feet when no rents are known. Give the tenant''s name only. Follow the KPI skill where it says more.'),
  ('largestTenantShareOfRent', 'Largest Tenant Share of Rent', 'property', 'percent', null, 'Commercial Leasing', 60, true,
   'The largest tenant''s annual base rent as a share of the property''s annual base rent.',
   '{calculated,documents,manual}', 'ask',
   E'**Also called:** Top Tenant Concentration.\n\n### How to Calculate\nThe largest tenant''s annual base rent divided by the annual base rent of all active leases, times 100. One decimal. Follow the KPI skill where it says more.'),

  ('occupiedUnits', 'Occupied Units', 'property', 'number', null, 'Residential Leasing', 10, true,
   'The number of units with a resident in place on the date of the latest rent roll.',
   '{documents,calculated,manual}', 'ask',
   E'**Also called:** Leased Units, Occupied Unit Count.\n\nFrom a document, take the count exactly as shown.\n\n### How to Calculate\nUse only when no document shows the figure. The number of units with an active lease. Follow the KPI skill where it says more.'),
  ('vacantUnits', 'Vacant Units', 'property', 'number', null, 'Residential Leasing', 20, true,
   'The number of units available to rent on the date of the latest rent roll.',
   '{documents,calculated,manual}', 'ask',
   E'**Also called:** Available Units.\n\nFrom a document, take the count exactly as shown. Model units, employee units and units held out of service are not vacant.\n\n### How to Calculate\nUse only when no document shows the figure. The number of units the latest rent roll marks Vacant. Follow the KPI skill where it says more.'),
  ('monthlyInPlaceRent', 'Monthly In-Place Rent', 'property', 'money', 'USD', 'Residential Leasing', 30, true,
   'The total monthly rent of the leases in place, before concessions and other income.',
   '{documents,calculated,manual}', 'ask',
   E'**Also called:** In-Place Rent, Total Lease Rent, Monthly Rent Roll.\n\nFrom a document, take the total of lease rent exactly as shown. Not market rent and not potential rent.\n\n### How to Calculate\nUse only when no document shows the figure. The monthly rent of the active leases added up; where a lease shows only an annual rent, one twelfth of it. Follow the KPI skill where it says more.'),
  ('averageRentPerUnit', 'Average Rent per Unit', 'property', 'money', 'USD per month', 'Residential Leasing', 40, true,
   'The average monthly rent of the occupied units.',
   '{documents,calculated,manual}', 'ask',
   E'**Also called:** Average In-Place Rent, Average Lease Rent.\n\n### How to Calculate\nUse only when no document shows the figure. Monthly In-Place Rent divided by Occupied Units. Whole dollars. Follow the KPI skill where it says more.'),
  ('averageUnitSize', 'Average Unit Size', 'property', 'number', 'SF', 'Residential Leasing', 50, true,
   'The average size of the property''s units, in square feet.',
   '{documents,calculated,manual}', 'ask',
   E'**Also called:** Average SF per Unit, Average Unit SF.\n\n### How to Calculate\nUse only when no document shows the figure. The square feet of every unit in the latest rent roll, occupied or not, divided by the number of units that show a size. Whole number. Follow the KPI skill where it says more.'),
  ('averageRentPerSquareFootMonthly', 'Average Rent per Square Foot (Monthly)', 'property', 'money', 'USD per SF per month', 'Residential Leasing', 60, true,
   'The average monthly rent per square foot of the occupied units, the way residential rents are quoted.',
   '{documents,calculated,manual}', 'ask',
   E'**Also called:** Rent PSF, In-Place Rent per SF.\n\n### How to Calculate\nUse only when no document shows the figure. Monthly In-Place Rent divided by the square feet of the occupied units. Two decimals. Follow the KPI skill where it says more.'),
  ('leasesExpiringWithin90Days', 'Leases Expiring Within 90 Days', 'property', 'number', null, 'Residential Leasing', 70, true,
   'The number of leases ending within 90 days of the latest rent roll''s date, month-to-month leases included.',
   '{calculated,documents,manual}', 'ask',
   E'**Also called:** Near-Term Expirations.\n\n### How to Calculate\nThe number of active leases ending within 90 days after the rent roll''s date, counting leases already past their end date (month-to-month). Follow the KPI skill where it says more.')
on conflict ((coalesce(org_id, '')), applies_to, key) do nothing;

insert into section_fields (section_id, field_id, position)
select s.id, f.id, f.sort_order
from field_definitions f
join sections s on s.org_id is null and s.applies_to = 'property'
  and s.key = case f.group_name when 'Commercial Leasing' then 'commercialLeasing' else 'residentialLeasing' end
where f.org_id is null and f.list_id is null and f.applies_to = 'property'
  and f.group_name in ('Commercial Leasing', 'Residential Leasing')
on conflict ((coalesce(org_id, '')), section_id, field_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Skills
-- ---------------------------------------------------------------------------

insert into skills (key, name, use_when, instructions, created_by, updated_by)
select v.key, v.name, v.use_when, v.instructions, 'stratios', 'stratios'
from (values
  ('calculating-commercial-kpis', 'Calculating Commercial KPIs',
   'KPIs are being calculated from stored leases for a commercial property: Office, Industrial, Retail, Hotel, Self-Storage, Mixed Use, Other, or any type that is not residential.',
   E'### What This Is\nStratios has saved a property''s rent roll and built its leases. You are given the property, the date of its latest rent roll, its active leases and its units with no lease. Calculate the values listed below, and only those.\n\n### Rules\n- Everything is as of the date of the latest rent roll.\n- Where the rent roll states its own total, leased or vacant square feet, use the stated figure, not your own addition of the rows.\n- Count only active leases. Space the owner uses (a management office, an amenity room) is leased space but has no tenant and no rent.\n- Use the sums Stratios supplies when they are exactly what a value asks for; otherwise work from the rows.\n- If a value cannot be worked out because something is missing (no areas, no lease end dates, no rents), leave it out and say why in the notes. Never estimate.\n- Give each value''s working: the figures used and the arithmetic.\n\n### Values to Calculate\n- **Total Rentable Square Feet:** the rent roll''s stated total; if none, the square feet of every unit, leased or not.\n- **Leased Square Feet:** the rent roll''s stated leased total; if none, the square feet of every unit marked Leased.\n- **Vacant Square Feet:** the rent roll''s stated vacant or available total; if none, the square feet of the units marked Vacant. Space marked Not for Lease is not vacant.\n- **Percent Leased:** Leased Square Feet divided by Total Rentable Square Feet, times 100. One decimal.\n- **Occupancy Rate:** square feet of the leased units whose lease has started on or before the rent roll''s date (units with no start date count as started), divided by Total Rentable Square Feet, times 100. One decimal. It is a monthly value, for the month of the rent roll.\n- **Number of Tenants:** the different tenants with an active lease. A tenant in several units counts once.\n- **Annual Base Rent:** the annual rent of the active leases added up; twelve times the monthly rent where only that is shown.\n- **Average Rent per Square Foot:** Annual Base Rent divided by the square feet of the active leases that show a rent. Two decimals. A monthly value, for the month of the rent roll.\n- **Weighted Average Lease Term:** for each active lease with an end date, the years from the rent roll''s date to the end date (zero if already past) times its square feet; add these up and divide by the square feet of those leases. One decimal.\n- **Lease Rollover Within 12 Months:** square feet of the active leases ending within 12 months after the rent roll''s date, leases already past their end date included, divided by the square feet of all active leases, times 100. One decimal.\n- **Largest Tenant:** the tenant whose active leases add up to the most annual rent (by square feet if no rents are known). The name only.\n- **Largest Tenant Share of Rent:** that tenant''s annual rent divided by Annual Base Rent, times 100. One decimal.\n\n### What to Say in the Notes\n- Anything left out and why.\n- If tenant names are still waiting to be confirmed, say that their rows are not counted as tenants yet and the KPIs should be recalculated once they are.'),
  ('calculating-residential-kpis', 'Calculating Residential KPIs',
   'KPIs are being calculated from stored leases for a residential property: Residential (apartments, single-family rentals, student or manufactured housing) or Seniors Housing.',
   E'### What This Is\nStratios has saved a property''s rent roll and built its leases. You are given the property, the date of its latest rent roll, its active leases and its units with no lease. Residential properties are measured in units and monthly rent, not square feet and annual rent. Calculate the values listed below, and only those.\n\n### Rules\n- Everything is as of the date of the latest rent roll.\n- Every row of the rent roll is one unit.\n- Model units, employee units and units held out of service (marked Not for Lease) count as units but are neither occupied nor vacant.\n- Rent means the lease rent in place. Not market rent, and before concessions and other charges.\n- Use the sums Stratios supplies when they are exactly what a value asks for; otherwise work from the rows.\n- If a value cannot be worked out because something is missing, leave it out and say why in the notes. Never estimate.\n- Give each value''s working: the figures used and the arithmetic.\n\n### Values to Calculate\n- **Unit Count:** the number of units in the rent roll.\n- **Occupied Units:** the number of units with an active lease.\n- **Vacant Units:** the number of units marked Vacant.\n- **Occupancy Rate:** Occupied Units divided by Unit Count, times 100. One decimal. By units, not square feet. It is a monthly value, for the month of the rent roll.\n- **Percent Leased:** units marked Leased, including leases that have not started yet, divided by Unit Count, times 100. One decimal.\n- **Total Rentable Square Feet:** the rent roll''s stated total; if none, the square feet of every unit.\n- **Monthly In-Place Rent:** the monthly rent of the active leases added up; one twelfth of the annual rent where only that is shown.\n- **Average Rent per Unit:** Monthly In-Place Rent divided by Occupied Units. Whole dollars.\n- **Average Unit Size:** the square feet of every unit divided by the number of units that show a size. Whole number.\n- **Average Rent per Square Foot (Monthly):** Monthly In-Place Rent divided by the square feet of the occupied units. Two decimals.\n- **Leases Expiring Within 90 Days:** the number of active leases ending within 90 days after the rent roll''s date, counting leases already past their end date (month-to-month).\n\n### Do Not Calculate\nNumber of Tenants, Weighted Average Lease Term, Average Rent per Square Foot (the yearly one) and the Commercial Leasing values. They are not used for residential property.\n\n### What to Say in the Notes\n- Anything left out and why.\n- How many leases are month-to-month or past their end date.')
) as v (key, name, use_when, instructions)
where not exists (select 1 from skills s where s.org_id is null and s.key = v.key);

-- ---------------------------------------------------------------------------
-- 4. The rent roll skill stops calculating while it reads
-- ---------------------------------------------------------------------------

update skills
set instructions = regexp_replace(
      instructions,
      '### Values to Calculate\n.*?(?=### )',
      E'### Values Are Calculated Afterwards\nDo not calculate any value while reading a rent roll. Once its rows are saved, Stratios builds the leases and calculates the property''s KPIs from them, following the Calculating Commercial KPIs or Calculating Residential KPIs skill. Take only the figures the rent roll itself shows.\n\n'),
    updated_at = now()
where org_id is null and key = 'reading-a-rent-roll'
  and position('### Values to Calculate' in instructions) > 0;

-- ---------------------------------------------------------------------------
-- 5. A record of each calculation
-- ---------------------------------------------------------------------------

create table if not exists kpi_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null,
  asset_id      uuid not null references assets (id) on delete cascade,
  property_id   uuid not null references properties (id) on delete cascade,
  rent_roll_id  uuid references rent_rolls (id) on delete set null,
  as_of_date    date not null,
  -- The skill the agent followed, as it was named at the time; null when none fitted.
  skill_key     text,
  skill_name    text,
  -- One entry per value: the field, the value, the working and what became of it.
  results       jsonb not null default '[]'::jsonb,
  notes         text,
  created_by    text not null,
  created_at    timestamptz not null default now()
);
create index if not exists kpi_runs_property_idx on kpi_runs (org_id, property_id, created_at desc);
create index if not exists kpi_runs_asset_idx on kpi_runs (org_id, asset_id);

alter table kpi_runs enable row level security;
alter table kpi_runs force row level security;
drop policy if exists kpi_runs_org_isolation on kpi_runs;
create policy kpi_runs_org_isolation on kpi_runs
  using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));

-- ---------------------------------------------------------------------------
-- 6. Fields an organization had already added for itself
-- ---------------------------------------------------------------------------

do $$
declare
  m record;
  new_key text;
  suffix int;
begin
  for m in
    select distinct on (o.org_id, s.id) o.id as old_id, s.id as new_id, o.org_id
    from (values
      ('leasedSquareFeet', 'leasedSquareFeet'),
      ('leasedSquareFeet', 'leasedSf'),
      ('leasedSquareFeet', 'totalLeasedSquareFeet'),
      ('vacantSquareFeet', 'vacantSquareFeet'),
      ('vacantSquareFeet', 'vacantSf'),
      ('vacantSquareFeet', 'availableVacantSf'),
      ('vacantSquareFeet', 'availableSquareFeet'),
      ('annualBaseRent', 'annualBaseRent'),
      ('annualBaseRent', 'inPlaceBaseRent'),
      ('annualBaseRent', 'inPlaceAnnualBaseRent'),
      ('largestTenant', 'largestTenant'),
      ('occupiedUnits', 'occupiedUnits'),
      ('vacantUnits', 'vacantUnits'),
      ('monthlyInPlaceRent', 'monthlyInPlaceRent'),
      ('averageRentPerUnit', 'averageRentPerUnit'),
      ('averageUnitSize', 'averageUnitSize')
    ) as a (standard_key, other_key)
    join field_definitions s on s.org_id is null and s.applies_to = 'property' and s.key = a.standard_key
    join field_definitions o on o.org_id is not null and o.applies_to = 'property' and lower(o.key) = lower(a.other_key)
    where o.list_id is null and o.retired_at is null and o.tracking = 'single' and o.core_column is null
      and (case when o.data_type in ('number', 'money', 'percent') then 'n' when o.data_type in ('text', 'picklist') then 't' else o.data_type end)
        = (case when s.data_type in ('number', 'money', 'percent') then 'n' when s.data_type in ('text', 'picklist') then 't' else s.data_type end)
      and not exists (select 1 from field_values v where v.org_id = o.org_id and v.field_id = s.id)
      and not exists (select 1 from field_source_values v where v.org_id = o.org_id and v.field_id = s.id)
    order by o.org_id, s.id, (lower(o.key) = lower(s.key)) desc, o.created_at
  loop
    update field_values set field_id = m.new_id where field_id = m.old_id;
    update field_value_history set field_id = m.new_id where field_id = m.old_id;
    update field_source_values set field_id = m.new_id where field_id = m.old_id;
    update document_findings set field_id = m.new_id where field_id = m.old_id;
    update field_proposals set field_id = m.new_id where field_id = m.old_id;
    update field_permissions set field_id = m.new_id where field_id = m.old_id;
    delete from field_definitions where id = m.old_id;
  end loop;

  for m in
    select o.id, o.org_id, o.applies_to, o.key, o.name
    from field_definitions o
    join field_definitions s on s.org_id is null and s.applies_to = o.applies_to and lower(s.key) = lower(o.key)
    where o.org_id is not null
  loop
    new_key := m.key || 'Custom';
    suffix := 1;
    while exists (
      select 1 from field_definitions f
      where f.applies_to = m.applies_to and lower(f.key) = lower(new_key) and (f.org_id is null or f.org_id = m.org_id)
    ) loop
      suffix := suffix + 1;
      new_key := m.key || 'Custom' || suffix;
    end loop;
    update field_definitions set key = new_key, name = left(m.name, 180) || ' (Custom)' where id = m.id;
  end loop;
end $$;

alter table field_definitions force row level security;
alter table sections force row level security;
alter table section_fields force row level security;
alter table field_values force row level security;
alter table field_value_history force row level security;
alter table field_source_values force row level security;
alter table document_findings force row level security;
alter table field_proposals force row level security;
alter table field_permissions force row level security;
alter table field_settings force row level security;
alter table skills force row level security;

commit;
