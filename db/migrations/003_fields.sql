-- Stratios data design, stage 1: the asset hierarchy, the field dictionary,
-- golden-record values, change history and per-source values.
-- Safe to run more than once.
--
-- Every organization-owned row carries org_id (the Clerk organization ID) and
-- is limited by row-level security to the organization the app sets for the
-- current transaction:  select set_config('app.org_id', '<org id>', true)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Core records: Asset > Property > Building > Floor > Unit, plus addresses.
-- Each has a short readable key that never changes (used by agents, formulas
-- and feeds); the name can be changed freely.
-- ---------------------------------------------------------------------------

alter table assets add column if not exists key text;

-- Give existing assets a key made from their name.
update assets a
set key = s.key
from (
  select id,
         case when rn = 1 then base else base || '-' || substr(id::text, 1, 6) end as key
  from (
    select id, base, row_number() over (partition by org_id, base order by created_at, id) as rn
    from (
      select id, org_id, created_at,
             coalesce(nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''), 'asset') as base
      from assets
      where key is null
    ) named
  ) numbered
) s
where a.id = s.id;

alter table assets alter column key set not null;
create unique index if not exists assets_org_key_idx on assets (org_id, key);
-- Property type and city now live on the property and its address.
alter table assets alter column asset_type drop not null;

create table if not exists properties (
  id             uuid primary key default gen_random_uuid(),
  org_id         text not null,
  asset_id       uuid not null references assets (id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  key            text not null,
  property_type  text,
  created_by     text not null,
  created_at     timestamptz not null default now()
);
create unique index if not exists properties_org_key_idx on properties (org_id, key);
create index if not exists properties_asset_idx on properties (asset_id);

create table if not exists buildings (
  id           uuid primary key default gen_random_uuid(),
  org_id       text not null,
  property_id  uuid not null references properties (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  key          text not null,
  created_by   text not null,
  created_at   timestamptz not null default now()
);
create unique index if not exists buildings_property_key_idx on buildings (property_id, key);

create table if not exists floors (
  id           uuid primary key default gen_random_uuid(),
  org_id       text not null,
  building_id  uuid not null references buildings (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  key          text not null,
  created_by   text not null,
  created_at   timestamptz not null default now()
);
create unique index if not exists floors_building_key_idx on floors (building_id, key);

create table if not exists units (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  floor_id    uuid not null references floors (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  key         text not null,
  created_by  text not null,
  created_at  timestamptz not null default now()
);
create unique index if not exists units_floor_key_idx on units (floor_id, key);

-- An address belongs to exactly one property, building or unit.
create table if not exists addresses (
  id           uuid primary key default gen_random_uuid(),
  org_id       text not null,
  property_id  uuid references properties (id) on delete cascade,
  building_id  uuid references buildings (id) on delete cascade,
  unit_id      uuid references units (id) on delete cascade,
  street       text,
  suite        text,
  city         text,
  state        text,
  postal_code  text,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  check (num_nonnulls(property_id, building_id, unit_id) = 1)
);
create index if not exists addresses_property_idx on addresses (property_id);
create index if not exists addresses_building_idx on addresses (building_id);
create index if not exists addresses_unit_idx on addresses (unit_id);

-- Existing assets get one property and one building, so every asset has the
-- same shape. The old type and city move down to the property and its address.
insert into properties (org_id, asset_id, name, key, property_type, created_by, created_at)
select a.org_id, a.id, a.name, a.key, a.asset_type, a.created_by, a.created_at
from assets a
where not exists (select 1 from properties p where p.asset_id = a.id);

insert into buildings (org_id, property_id, name, key, created_by, created_at)
select p.org_id, p.id, 'Main Building', 'main-building', p.created_by, p.created_at
from properties p
where not exists (select 1 from buildings b where b.property_id = p.id);

insert into addresses (org_id, property_id, city, created_by, created_at)
select p.org_id, p.id, a.city, p.created_by, p.created_at
from properties p
join assets a on a.id = p.asset_id
where a.city is not null
  and not exists (select 1 from addresses d where d.property_id = p.id);

-- ---------------------------------------------------------------------------
-- Source types: generic kinds of source, never vendor names. An organization's
-- own systems (Yardi, MRI and so on) are connected to one of these later.
-- ---------------------------------------------------------------------------

create table if not exists source_types (
  key           text primary key,
  name          text not null,
  in_waterfall  boolean not null default true,
  sort_order    int not null default 0
);

insert into source_types (key, name, in_waterfall, sort_order) values
  ('propertyManagementSystem', 'Property Management System', true, 10),
  ('accountingSystem',         'Accounting System',          true, 20),
  ('marketData',               'Market Data',                true, 30),
  ('documents',                'Documents',                  true, 40),
  ('manual',                   'Manual Entry',               true, 50),
  ('calculated',               'Calculated',                 false, 60)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Field dictionary. org_id null = a Stratios standard field, shared by every
-- organization; otherwise a field that one organization added for itself.
-- ---------------------------------------------------------------------------

create table if not exists field_definitions (
  id                uuid primary key default gen_random_uuid(),
  org_id            text,
  key               text not null check (key ~ '^[a-z][A-Za-z0-9]*$'),
  name              text not null check (length(trim(name)) > 0),
  applies_to        text not null check (applies_to in ('asset', 'property', 'building', 'floor', 'unit')),
  data_type         text not null check (data_type in ('text', 'number', 'money', 'percent', 'date', 'boolean', 'picklist')),
  unit              text,                 -- shown after a number, e.g. SF or acres
  options           jsonb,                -- choices for a pick list
  tracking          text not null default 'single' check (tracking in ('single', 'monthly')),
  rollup            text check (rollup in ('sum', 'average', 'last', 'direct')),
  calculated        boolean not null default false,
  formula           text,                 -- plain description until formulas are built
  core_column       text check (core_column in ('name', 'property_type')),  -- also kept in a fixed column
  group_name        text not null,        -- the section it shows under, e.g. KPIs
  sort_order        int not null default 0,
  ai_description    text,
  other_names       text[] not null default '{}',
  extraction_hints  text,
  source_priority   text[] not null default '{manual}',   -- the waterfall, highest first
  when_empty        text not null default 'fill' check (when_empty in ('fill', 'ask')),
  when_different    text not null default 'ask' check (when_different in ('ask', 'replace', 'never')),
  manual_override   text not null default 'stays' check (manual_override in ('stays', 'replaceable')),
  retired_at        timestamptz,
  created_at        timestamptz not null default now()
);
create unique index if not exists field_definitions_key_idx
  on field_definitions ((coalesce(org_id, '')), applies_to, key);

-- An organization's change to one setting of a field. Only the changed setting
-- is stored, so Stratios updates still reach every setting left untouched.
-- A row here is the "modified" flag for that setting.
create table if not exists field_settings (
  org_id       text not null,
  field_id     uuid not null references field_definitions (id) on delete cascade,
  setting      text not null,
  value        jsonb,
  modified_by  text not null,
  modified_at  timestamptz not null default now(),
  primary key (org_id, field_id, setting)
);

-- ---------------------------------------------------------------------------
-- Values. field_values is the golden record: one row per record, field and
-- period. field_value_history gets a row only when a golden value changes.
-- field_source_values keeps what each source type currently says.
-- row_id is reserved for lists (fields grouped by row).
-- ---------------------------------------------------------------------------

create table if not exists field_values (
  id               uuid primary key default gen_random_uuid(),
  org_id           text not null,
  record_type      text not null check (record_type in ('asset', 'property', 'building', 'floor', 'unit')),
  record_id        uuid not null,
  field_id         uuid not null references field_definitions (id),
  period           date,                -- first day of the month; null for single-value fields
  row_id           uuid,
  value_text       text,
  value_number     numeric,
  value_date       date,
  value_bool       boolean,
  source_type      text not null references source_types (key),
  confidence       numeric,
  status           text not null default 'approved' check (status in ('approved', 'proposed')),
  note             text,
  manual_override  boolean not null default false,
  updated_by       text not null,
  updated_at       timestamptz not null default now()
);
create unique index if not exists field_values_golden_idx on field_values (
  org_id, record_type, record_id, field_id,
  (coalesce(period, date '0001-01-01')),
  (coalesce(row_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

create table if not exists field_value_history (
  id           uuid primary key default gen_random_uuid(),
  org_id       text not null,
  record_type  text not null,
  record_id    uuid not null,
  field_id     uuid not null references field_definitions (id),
  period       date,
  row_id       uuid,
  old_text     text,
  old_number   numeric,
  old_date     date,
  old_bool     boolean,
  new_text     text,
  new_number   numeric,
  new_date     date,
  new_bool     boolean,
  source_type  text not null references source_types (key),
  note         text,
  changed_by   text not null,
  changed_at   timestamptz not null default now()
);
create index if not exists field_value_history_lookup_idx
  on field_value_history (org_id, record_type, record_id, field_id, changed_at desc);

create table if not exists field_source_values (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null,
  record_type   text not null,
  record_id     uuid not null,
  field_id      uuid not null references field_definitions (id),
  period        date,
  row_id        uuid,
  source_type   text not null references source_types (key),
  value_text    text,
  value_number  numeric,
  value_date    date,
  value_bool    boolean,
  received_by   text not null,
  received_at   timestamptz not null default now()
);
create unique index if not exists field_source_values_idx on field_source_values (
  org_id, record_type, record_id, field_id, source_type,
  (coalesce(period, date '0001-01-01')),
  (coalesce(row_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

-- ---------------------------------------------------------------------------
-- Stratios standard fields (the starter set). Standard rows have no
-- organization, which the row-level security rules below would refuse, so
-- the rules are lifted for the table owner here and put back further down.
-- ---------------------------------------------------------------------------

alter table field_definitions no force row level security;

insert into field_definitions
  (key, name, applies_to, data_type, unit, options, tracking, rollup, calculated, formula, core_column,
   group_name, sort_order, ai_description, other_names, source_priority)
values
  -- Asset Details
  ('assetName', 'Asset Name', 'asset', 'text', null, null, 'single', null, false, null, 'name',
   'Asset Details', 10, 'The name the organization uses for the investment as a whole.',
   '{"Investment Name","Deal Name"}', '{manual,documents}'),
  ('acquisitionDate', 'Acquisition Date', 'asset', 'date', null, null, 'single', null, false, null, null,
   'Asset Details', 20, 'The date the organization closed on the purchase of the asset.',
   '{"Closing Date","Purchase Date","Date Acquired"}', '{documents,manual}'),
  ('purchasePrice', 'Purchase Price', 'asset', 'money', 'USD', null, 'single', null, false, null, null,
   'Asset Details', 30, 'The total price paid to acquire the asset, before closing costs.',
   '{"Acquisition Price","Sale Price","Offering Price"}', '{documents,manual}'),
  ('currentValue', 'Current Value', 'asset', 'money', 'USD', null, 'single', null, false, null, null,
   'Asset Details', 40, 'The most recent appraised or internally estimated value of the asset.',
   '{"Appraised Value","Market Value","Fair Value"}', '{documents,manual}'),
  ('valuationDate', 'Valuation Date', 'asset', 'date', null, null, 'single', null, false, null, null,
   'Asset Details', 50, 'The date the current value was determined.',
   '{"Appraisal Date","As-Of Date"}', '{documents,manual}'),

  -- Debt
  ('lender', 'Lender', 'asset', 'text', null, null, 'single', null, false, null, null,
   'Debt', 10, 'The institution that holds the senior loan on the asset.',
   '{"Lender Name","Mortgagee"}', '{documents,manual}'),
  ('interestRate', 'Interest Rate', 'asset', 'percent', null, null, 'single', null, false, null, null,
   'Debt', 20, 'The current annual interest rate on the senior loan.',
   '{"Rate","Coupon","Note Rate"}', '{documents,accountingSystem,manual}'),
  ('loanMaturityDate', 'Loan Maturity Date', 'asset', 'date', null, null, 'single', null, false, null, null,
   'Debt', 30, 'The date the senior loan comes due.',
   '{"Maturity Date","Loan Maturity"}', '{documents,manual}'),
  ('loanBalance', 'Loan Balance', 'asset', 'money', 'USD', null, 'monthly', 'last', false, null, null,
   'Debt', 40, 'The outstanding principal on the senior loan at the end of the period.',
   '{"Outstanding Balance","Principal Balance","Debt Balance"}', '{accountingSystem,documents,manual}'),
  ('debtService', 'Debt Service', 'asset', 'money', 'USD', null, 'monthly', 'sum', false, null, null,
   'Debt', 50, 'Principal and interest paid on the senior loan during the period.',
   '{"Debt Payments","P&I"}', '{accountingSystem,documents,manual}'),

  -- Property Details
  ('propertyName', 'Property Name', 'property', 'text', null, null, 'single', null, false, null, 'name',
   'Property Details', 10, 'The name the property is known by.',
   '{"Property","Building Name","Project Name"}', '{manual,propertyManagementSystem,documents}'),
  ('propertyType', 'Property Type', 'property', 'picklist', null,
   '["Office","Retail","Industrial","Multifamily","Mixed Use","Other"]', 'single', null, false, null, 'property_type',
   'Property Details', 20, 'The main use of the property.',
   '{"Asset Type","Asset Class","Use"}', '{manual,documents}'),
  ('buildingClass', 'Building Class', 'property', 'picklist', null, '["A","B","C"]', 'single', null, false, null, null,
   'Property Details', 30, 'The market quality class of the property: A, B or C.',
   '{"Class","Property Class"}', '{documents,marketData,manual}'),
  ('market', 'Market', 'property', 'text', null, null, 'single', null, false, null, null,
   'Property Details', 40, 'The metropolitan market the property is in.',
   '{"Metro","MSA"}', '{marketData,documents,manual}'),
  ('submarket', 'Submarket', 'property', 'text', null, null, 'single', null, false, null, null,
   'Property Details', 50, 'The submarket within the metropolitan market.',
   '{"Sub-Market","Neighborhood"}', '{marketData,documents,manual}'),
  ('landAreaAcres', 'Land Area', 'property', 'number', 'acres', null, 'single', null, false, null, null,
   'Property Details', 60, 'The size of the site in acres.',
   '{"Site Area","Lot Size","Acreage"}', '{documents,manual}'),
  ('parkingSpaces', 'Parking Spaces', 'property', 'number', null, null, 'single', null, false, null, null,
   'Property Details', 70, 'The number of parking spaces on the property.',
   '{"Parking","Parking Stalls"}', '{documents,propertyManagementSystem,manual}'),
  ('unitCount', 'Unit Count', 'property', 'number', null, null, 'single', null, false, null, null,
   'Property Details', 80, 'The number of leasable units or suites on the property.',
   '{"Units","Number of Units","Suites"}', '{propertyManagementSystem,documents,manual}'),
  ('totalRentableSquareFeet', 'Total Rentable Square Feet', 'property', 'number', 'SF', null, 'single', null, true,
   'Sum of Rentable Square Feet across the property''s buildings', null,
   'Property Details', 90, 'The rentable area of all buildings on the property added together.',
   '{"Total RSF","Total NRA","GLA"}', '{}'),

  -- Building Details
  ('yearBuilt', 'Year Built', 'building', 'number', null, null, 'single', null, false, null, null,
   'Building Details', 10, 'The year construction of the building was completed.',
   '{"Built","Year of Construction"}', '{documents,manual}'),
  ('yearRenovated', 'Year Renovated', 'building', 'number', null, null, 'single', null, false, null, null,
   'Building Details', 20, 'The year of the most recent major renovation.',
   '{"Renovated","Last Renovation"}', '{documents,manual}'),
  ('floorCount', 'Floor Count', 'building', 'number', null, null, 'single', null, false, null, null,
   'Building Details', 30, 'The number of floors in the building.',
   '{"Stories","Number of Floors"}', '{documents,manual}'),
  ('rentableSquareFeet', 'Rentable Square Feet', 'building', 'number', 'SF', null, 'single', null, false, null, null,
   'Building Details', 40, 'The rentable area of the building in square feet.',
   '{"RSF","NRA","Net Rentable Area","Square Footage"}', '{propertyManagementSystem,documents,manual}'),

  -- KPIs
  ('occupancyRate', 'Occupancy Rate', 'property', 'percent', null, null, 'monthly', 'last', false, null, null,
   'KPIs', 10, 'The share of rentable area that is leased at the end of the period.',
   '{"Occupancy","Percent Leased","Leased %"}', '{propertyManagementSystem,documents,manual}'),
  ('averageRentPerSquareFoot', 'Average Rent per Square Foot', 'property', 'money', 'USD per SF', null, 'monthly', 'average', false, null, null,
   'KPIs', 20, 'Average annual in-place rent per rentable square foot.',
   '{"Avg Rent PSF","In-Place Rent","Rent PSF"}', '{propertyManagementSystem,documents,manual}'),
  ('marketRentPerSquareFoot', 'Market Rent per Square Foot', 'property', 'money', 'USD per SF', null, 'monthly', 'average', false, null, null,
   'KPIs', 30, 'Average annual asking rent per square foot for comparable space in the submarket.',
   '{"Market Rent PSF","Asking Rent"}', '{marketData,documents,manual}'),
  ('totalRevenue', 'Total Revenue', 'property', 'money', 'USD', null, 'monthly', 'sum', false, null, null,
   'KPIs', 40, 'All income the property earned in the period.',
   '{"Revenue","Effective Gross Income","EGI","Total Income"}', '{accountingSystem,propertyManagementSystem,documents}'),
  ('operatingExpenses', 'Operating Expenses', 'property', 'money', 'USD', null, 'monthly', 'sum', false, null, null,
   'KPIs', 50, 'The cost of running the property in the period, before debt service and capital spending.',
   '{"OpEx","Total Expenses","Total Operating Expenses"}', '{accountingSystem,propertyManagementSystem,documents}'),
  ('netOperatingIncome', 'Net Operating Income', 'property', 'money', 'USD', null, 'monthly', 'sum', true,
   'Total Revenue minus Operating Expenses', null,
   'KPIs', 60, 'Income after operating expenses, before debt service.',
   '{"NOI"}', '{}'),
  ('goingInCapRate', 'Going-In Cap Rate', 'property', 'percent', null, null, 'single', null, true,
   'First-year Net Operating Income divided by Purchase Price', null,
   'KPIs', 70, 'First-year net operating income as a share of the purchase price.',
   '{"Cap Rate","Going-In Cap","Capitalization Rate"}', '{}'),
  ('debtServiceCoverageRatio', 'Debt Service Coverage Ratio', 'property', 'number', 'x', null, 'monthly', null, true,
   'Net Operating Income divided by Debt Service', null,
   'KPIs', 80, 'How many times net operating income covers debt service.',
   '{"DSCR","Debt Coverage"}', '{}'),
  ('loanToValue', 'Loan to Value', 'property', 'percent', null, null, 'monthly', 'last', true,
   'Loan Balance divided by Current Value', null,
   'KPIs', 90, 'The loan balance as a share of the current value.',
   '{"LTV"}', '{}')
on conflict ((coalesce(org_id, '')), applies_to, key) do nothing;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Organization-owned tables: every row is limited to its organization.
do $$
declare
  t text;
begin
  foreach t in array array[
    'properties', 'buildings', 'floors', 'units', 'addresses',
    'field_settings', 'field_values', 'field_value_history', 'field_source_values'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_org_isolation', t);
    execute format(
      'create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))',
      t || '_org_isolation', t
    );
  end loop;
end $$;

-- The dictionary: everyone reads the Stratios standard fields and their own
-- organization's fields; an organization can only add or change its own.
alter table field_definitions enable row level security;
alter table field_definitions force row level security;
drop policy if exists field_definitions_read on field_definitions;
create policy field_definitions_read on field_definitions for select
  using (org_id is null or org_id = current_setting('app.org_id', true));
drop policy if exists field_definitions_insert on field_definitions;
create policy field_definitions_insert on field_definitions for insert
  with check (org_id = current_setting('app.org_id', true));
drop policy if exists field_definitions_update on field_definitions;
create policy field_definitions_update on field_definitions for update
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));
drop policy if exists field_definitions_delete on field_definitions;
create policy field_definitions_delete on field_definitions for delete
  using (org_id = current_setting('app.org_id', true));

-- Source types are the same for everyone and read-only to the app.
alter table source_types enable row level security;
drop policy if exists source_types_read on source_types;
create policy source_types_read on source_types for select using (true);
