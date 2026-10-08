-- Organization settings: company domain and color schemes, one row per
-- organization (keyed by the Clerk organization ID).

create table if not exists organization_settings (
  org_id           text primary key,
  domain           text unique,          -- company email domain, e.g. cbre.com
  theme            jsonb,                -- ten site colors, mode, brand colors
  generated_brand  jsonb,                -- brand colors found at set-up
  chart_colors     jsonb,                -- eight graph colors and their source
  updated_at       timestamptz not null default now()
);

-- Row-level security on, with no policies: only the Stratios server (which
-- connects as the table's owner) can read or write this table. Supabase's
-- public API keys get nothing.
alter table organization_settings enable row level security;
