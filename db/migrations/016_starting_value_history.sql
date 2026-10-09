-- Fills in the history that starting values never got.
--
-- When an asset is created, its name and its property's name and type are
-- saved as the first values of those fields, but until now nothing was
-- written to their history, so History said "No changes recorded yet". And
-- when the agent created the asset from a document, those values were marked
-- Manual Entry although they were read from the document.
--
-- This file fixes values that already exist. New assets are handled by the
-- application. Run after 015_address_coordinates.sql. Safe to run more than
-- once: it only touches values that have no history at all.

-- Row-level rules are lifted for the owner while this runs, so it works for
-- an owner role without BYPASSRLS, and put back at the end.
alter table assets no force row level security;
alter table properties no force row level security;
alter table documents no force row level security;
alter table field_values no force row level security;
alter table field_value_history no force row level security;

-- 1. Starting values of assets the agent created from a document: say so.
--    Such an asset was created while its document was being read, between the
--    moment the reading started and the moment it finished.
with made as (
  select a.id as asset_id, a.org_id, d.name as document_name
  from assets a
  join documents d on d.asset_id = a.id and d.org_id = a.org_id
  where d.read_started_at is not null
    and a.created_at >= d.read_started_at
    and (d.read_at is null or a.created_at <= d.read_at)
), records as (
  select m.org_id, m.document_name, 'asset'::text as record_type, m.asset_id as record_id from made m
  union all
  select m.org_id, m.document_name, 'property', p.id from made m join properties p on p.asset_id = m.asset_id and p.org_id = m.org_id
)
update field_values v
set source_type = 'documents',
    manual_override = false,
    note = coalesce(v.note, 'From "' || r.document_name || '"')
from records r, field_definitions f
where v.org_id = r.org_id
  and v.record_type = r.record_type
  and v.record_id = r.record_id
  and f.id = v.field_id
  and f.core_column is not null
  and v.source_type = 'manual'
  and not exists (
    select 1 from field_value_history h
    where h.org_id = v.org_id and h.record_type = v.record_type and h.record_id = v.record_id and h.field_id = v.field_id
      and h.period is not distinct from v.period and h.row_id is not distinct from v.row_id
  );

-- 2. Every value with no history gets its first entry: set from empty to the
--    value, by whoever saved it, at the time it was saved, from its source.
insert into field_value_history
  (org_id, record_type, record_id, field_id, period,
   new_text, new_number, new_date, new_bool, source_type, note, changed_by, changed_at, row_id)
select v.org_id, v.record_type, v.record_id, v.field_id, v.period,
       v.value_text, v.value_number, v.value_date, v.value_bool, v.source_type, v.note, v.updated_by, v.updated_at, v.row_id
from field_values v
where (v.value_text is not null or v.value_number is not null or v.value_date is not null or v.value_bool is not null)
  and not exists (
    select 1 from field_value_history h
    where h.org_id = v.org_id and h.record_type = v.record_type and h.record_id = v.record_id and h.field_id = v.field_id
      and h.period is not distinct from v.period and h.row_id is not distinct from v.row_id
  );

alter table assets force row level security;
alter table properties force row level security;
alter table documents force row level security;
alter table field_values force row level security;
alter table field_value_history force row level security;
