-- Stratios data design, stage 4: document upload and the extraction agent.
-- Run after 007_agent_instructions.sql. Safe to run more than once.
--
-- documents           one uploaded file, linked to an asset
-- document_chunks     the file itself, stored in pieces (uploads arrive in
--                     pieces because the web host limits the size of one request)
-- document_findings   each value the agent found, what happened to it, and
--                     any decision a person made about it (the review list)
-- field_proposals     values the agent found that match no existing field
--
-- field_source_values also learns which document and page a value came from.

create table if not exists documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           text not null,
  asset_id         uuid not null references assets (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  content_type     text not null,
  size_bytes       bigint not null check (size_bytes > 0),
  chunk_count      int not null check (chunk_count > 0),
  -- uploading -> uploaded -> reading -> read, or failed (with the reason in error)
  status           text not null default 'uploading' check (status in ('uploading', 'uploaded', 'reading', 'read', 'failed')),
  error            text,
  document_type    text,          -- what the agent says it is, e.g. Offering Memorandum
  summary          text,          -- the agent's one-paragraph summary
  uploaded_by      text not null,
  uploaded_at      timestamptz not null default now(),
  read_started_at  timestamptz,
  read_at          timestamptz,
  read_by          text
);
create index if not exists documents_asset_idx on documents (org_id, asset_id, uploaded_at desc);

create table if not exists document_chunks (
  document_id  uuid not null references documents (id) on delete cascade,
  org_id       text not null,
  chunk_index  int not null check (chunk_index >= 0),
  data         bytea not null,
  primary key (document_id, chunk_index)
);

create table if not exists document_findings (
  id              uuid primary key default gen_random_uuid(),
  org_id          text not null,
  document_id     uuid not null references documents (id) on delete cascade,
  record_type     text not null check (record_type in ('asset', 'property', 'building', 'floor', 'unit')),
  record_id       uuid not null,
  field_id        uuid not null references field_definitions (id),
  period          date,
  -- what the document says
  value_text      text,
  value_number    numeric,
  value_date      date,
  value_bool      boolean,
  page            int,
  confidence      text check (confidence in ('high', 'medium', 'low')),
  quote           text,
  -- what happened when it was read:
  --   filled     the field was empty and was filled in
  --   confirmed  the golden record already said the same
  --   replaced   the golden record was different and was replaced
  --   decision   a person has to choose (see reason)
  --   kept       the golden record was different and is never replaced
  outcome         text not null check (outcome in ('filled', 'confirmed', 'replaced', 'decision', 'kept')),
  -- why a decision is needed: empty (the field asks before filling),
  -- different (the field asks which to keep), manual (a hand-entered value stays)
  reason          text check (reason in ('empty', 'different', 'manual')),
  -- the golden record as it was when the document was read
  current_text    text,
  current_number  numeric,
  current_date_value date,
  current_bool    boolean,
  current_source  text,
  -- the person's choice, for outcome = decision
  decision        text check (decision in ('accepted', 'rejected')),
  decided_by      text,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists document_findings_document_idx on document_findings (org_id, document_id);

create table if not exists field_proposals (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null,
  document_id   uuid not null references documents (id) on delete cascade,
  record_type   text not null check (record_type in ('asset', 'property', 'building')),
  record_id     uuid not null,
  name          text not null,
  data_type     text not null check (data_type in ('text', 'number', 'money', 'percent', 'date', 'boolean')),
  value         text not null,   -- as found; parsed when the field is added
  page          int,
  reason        text,            -- why the agent thinks it is worth keeping
  status        text not null default 'proposed' check (status in ('proposed', 'added', 'dismissed')),
  field_id      uuid references field_definitions (id),   -- the field created from it
  decided_by    text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists field_proposals_document_idx on field_proposals (org_id, document_id);

alter table field_source_values add column if not exists document_id uuid references documents (id) on delete set null;
alter table field_source_values add column if not exists page int;

-- Each organization sees and changes only its own rows.
do $$
declare
  t text;
begin
  foreach t in array array['documents', 'document_chunks', 'document_findings', 'field_proposals'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_org_isolation', t);
    execute format(
      'create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))',
      t || '_org_isolation', t
    );
  end loop;
end $$;
