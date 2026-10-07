-- Stratios initial schema.
-- Every row belongs to an organization (the Clerk organization ID).
-- Row-level security restricts each query to the organization set by the app
-- for the current transaction:  select set_config('app.org_id', '<org id>', true)

create extension if not exists pgcrypto;

create table if not exists assets (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  name        text not null check (length(trim(name)) > 0),
  asset_type  text not null,
  city        text,
  created_by  text not null,
  created_at  timestamptz not null default now()
);

create index if not exists assets_org_id_idx on assets (org_id, created_at desc);

alter table assets enable row level security;
-- Apply the policy to the table owner as well.
alter table assets force row level security;

drop policy if exists assets_org_isolation on assets;
create policy assets_org_isolation on assets
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));
