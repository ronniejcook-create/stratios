-- Tenants, leases and units from rent rolls.
-- Run after 023_property_types.sql. Safe to run more than once.
--
-- A rent roll stays what it is: a dated copy of a document's table. This adds
-- the lasting records its rows stand for:
--
-- 1. tenants: one row per tenant of the organization, whatever property it is
--    in. A tenant keeps the other spellings of its name a person confirmed.
-- 2. leases: one row per tenant, unit and lease start at a property, holding
--    the terms from the most recent rent roll that shows it. A lease is active
--    while the property's latest rent roll shows it, and past after that.
-- 3. tenant_questions: a name in a rent roll that looks like an existing
--    tenant but is not spelled the same waits here for a person to say
--    whether it is the same tenant. Nothing is matched by guesswork.
-- 4. Each rent roll row points at its unit (the units table, under the
--    property's building and floor), its tenant and its lease.

create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  key         text not null,
  name        text not null check (length(trim(name)) > 0),
  -- Other spellings confirmed as this tenant: ["Acme Corporation", "ACME Corp."]
  aliases     jsonb not null default '[]'::jsonb,
  created_by  text not null,
  created_at  timestamptz not null default now()
);
create unique index if not exists tenants_org_key_idx on tenants (org_id, key);

create table if not exists leases (
  id                 uuid primary key default gen_random_uuid(),
  org_id             text not null,
  asset_id           uuid not null references assets (id) on delete cascade,
  property_id        uuid not null references properties (id) on delete cascade,
  tenant_id          uuid not null references tenants (id) on delete cascade,
  unit_id            uuid references units (id) on delete set null,
  -- The unit as the rent roll writes it, kept in case the unit record goes.
  unit_name          text,
  start_date         date,
  end_date           date,
  square_feet        numeric,
  rent_per_sf        numeric,
  annual_rent        numeric,
  monthly_rent       numeric,
  recovery_type      text,
  steps              jsonb not null default '[]'::jsonb,
  -- active: the property's latest rent roll shows it. past: it no longer does.
  status             text not null default 'active' check (status in ('active', 'past')),
  -- The dates of the first and the latest rent roll that show it.
  first_seen         date not null,
  last_seen          date not null,
  last_rent_roll_id  uuid references rent_rolls (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists leases_property_idx on leases (org_id, property_id, status);
create index if not exists leases_tenant_idx on leases (org_id, tenant_id);
create index if not exists leases_asset_idx on leases (org_id, asset_id);

create table if not exists tenant_questions (
  id                   uuid primary key default gen_random_uuid(),
  org_id               text not null,
  -- The name as the rent roll writes it, and the same name in a plain form for comparing.
  written_name         text not null,
  name_key             text not null,
  suggested_tenant_id  uuid not null references tenants (id) on delete cascade,
  status               text not null default 'pending' check (status in ('pending', 'same', 'different')),
  decided_by           text,
  decided_at           timestamptz,
  created_at           timestamptz not null default now()
);
create unique index if not exists tenant_questions_name_idx on tenant_questions (org_id, name_key);

alter table rent_roll_rows add column if not exists unit_id uuid references units (id) on delete set null;
alter table rent_roll_rows add column if not exists tenant_id uuid references tenants (id) on delete set null;
alter table rent_roll_rows add column if not exists lease_id uuid references leases (id) on delete set null;
create index if not exists rent_roll_rows_tenant_idx on rent_roll_rows (org_id, tenant_id);
create index if not exists rent_roll_rows_lease_idx on rent_roll_rows (lease_id);

do $$
declare
  t text;
begin
  foreach t in array array['tenants', 'leases', 'tenant_questions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_org_isolation', t);
    execute format(
      'create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))',
      t || '_org_isolation', t
    );
  end loop;
end $$;
