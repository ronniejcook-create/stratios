-- Photos on an asset: pulled out of a document when it is read (an Offering
-- Memorandum's pictures), or uploaded by a person.
-- Run after 012_organization_skills.sql. Safe to run more than once.
--
-- The picture itself is kept in this table (data), like document files are
-- kept in document_chunks, so nothing new has to be configured. Lists never
-- read that column; only the request that shows one photo does.

create table if not exists asset_photos (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null,
  asset_id      uuid not null references assets (id) on delete cascade,
  -- where it came from: a document and page, or null for an uploaded photo
  document_id   uuid references documents (id) on delete set null,
  page          int,
  file_name     text,
  -- what it shows, as the agent or a person labeled it
  category      text not null default 'other' check (category in ('exterior', 'interior', 'aerial', 'area', 'plan', 'other')),
  caption       text,
  -- the one photo that stands for the asset in lists and at the top of its page
  is_main       boolean not null default false,
  content_type  text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  width         int,
  height        int,
  size_bytes    int not null check (size_bytes > 0),
  -- a fingerprint of the picture, so reading a document again never adds the same photo twice
  sha256        text not null,
  sort_order    int not null default 0,
  data          bytea not null,
  created_by    text not null,
  created_at    timestamptz not null default now()
);
create index if not exists asset_photos_asset_idx on asset_photos (org_id, asset_id, sort_order, created_at);
create unique index if not exists asset_photos_unique_idx on asset_photos (asset_id, sha256);
create unique index if not exists asset_photos_main_idx on asset_photos (asset_id) where is_main;

-- Each organization sees and changes only its own photos.
alter table asset_photos enable row level security;
alter table asset_photos force row level security;
drop policy if exists asset_photos_org_isolation on asset_photos;
create policy asset_photos_org_isolation on asset_photos
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));
