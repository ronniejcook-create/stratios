-- Rent rolls: each one loaded is kept as a dated snapshot of a property's
-- suites, tenants, rents and lease dates.
-- Run after 018_calculated_values.sql. Safe to run more than once.
--
-- A rent roll belongs to one property of one asset, and usually came from a
-- document. Loading a later rent roll adds a new snapshot; earlier ones are
-- kept, so two dates can be compared. Removing the document keeps the
-- snapshot; deleting the asset deletes it.

create table if not exists rent_rolls (
  id               uuid primary key default gen_random_uuid(),
  org_id           text not null,
  asset_id         uuid not null references assets (id) on delete cascade,
  property_id      uuid not null references properties (id) on delete cascade,
  document_id      uuid references documents (id) on delete set null,
  document_name    text,
  as_of_date       date not null,
  -- False when the document gave no date and the day it was loaded was used.
  as_of_stated     boolean not null default true,
  -- Totals the document itself shows, to check the rows against.
  stated_total_sf   numeric,
  stated_leased_sf  numeric,
  stated_vacant_sf  numeric,
  created_by       text not null,
  created_at       timestamptz not null default now()
);
create index if not exists rent_rolls_asset_idx on rent_rolls (org_id, asset_id, as_of_date desc);
create index if not exists rent_rolls_document_idx on rent_rolls (document_id);

create table if not exists rent_roll_rows (
  id             uuid primary key default gen_random_uuid(),
  org_id         text not null,
  rent_roll_id   uuid not null references rent_rolls (id) on delete cascade,
  position       int not null,
  suite          text,
  tenant         text,
  -- leased: a tenant holds the space. vacant: available to lease.
  -- other: space the document sets apart as not for lease.
  status         text not null check (status in ('leased', 'vacant', 'other')),
  square_feet    numeric,
  lease_start    date,
  lease_end      date,
  rent_per_sf    numeric,   -- base rent per square foot per year
  annual_rent    numeric,
  monthly_rent   numeric,
  recovery_type  text,
  note           text,
  -- Future rent changes: [{"date": "2027-07-01", "rentPerSf": 24.5, "annualRent": 33737}]
  steps          jsonb not null default '[]'::jsonb,
  page           int
);
create index if not exists rent_roll_rows_roll_idx on rent_roll_rows (rent_roll_id, position);

do $$
declare
  t text;
begin
  foreach t in array array['rent_rolls', 'rent_roll_rows'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_org_isolation', t);
    execute format(
      'create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))',
      t || '_org_isolation', t
    );
  end loop;
end $$;
