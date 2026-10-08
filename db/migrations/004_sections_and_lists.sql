-- Stratios data design, stage 2: screens, sections and lists.
-- Run after 003_fields.sql. Safe to run more than once.
--
-- A screen is a tab on the asset page. A section is a titled group on a
-- screen and shows either fields (as a form or as tiles) or a list.
-- A list is a group of fields that repeats, one row per entry.
-- org_id null = part of the Stratios standard layout, shared by everyone.

-- ---------------------------------------------------------------------------
-- Screens and sections
-- ---------------------------------------------------------------------------

create table if not exists screens (
  id          uuid primary key default gen_random_uuid(),
  org_id      text,
  key         text not null check (key ~ '^[a-z][A-Za-z0-9]*$'),
  name        text not null check (length(trim(name)) > 0),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists screens_key_idx on screens ((coalesce(org_id, '')), key);

create table if not exists sections (
  id             uuid primary key default gen_random_uuid(),
  org_id         text,
  screen_id      uuid not null references screens (id) on delete cascade,
  key            text not null check (key ~ '^[a-z][A-Za-z0-9]*$'),
  name           text not null check (length(trim(name)) > 0),
  applies_to     text not null check (applies_to in ('asset', 'property', 'building', 'floor', 'unit')),
  display_style  text not null default 'form' check (display_style in ('form', 'tiles', 'list')),
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);
create unique index if not exists sections_key_idx on sections ((coalesce(org_id, '')), applies_to, key);

-- Which field sits in which section, and in what order.
create table if not exists section_fields (
  id          uuid primary key default gen_random_uuid(),
  org_id      text,
  section_id  uuid not null references sections (id) on delete cascade,
  field_id    uuid not null references field_definitions (id) on delete cascade,
  position    int not null default 0
);
create unique index if not exists section_fields_idx on section_fields ((coalesce(org_id, '')), section_id, field_id);

-- ---------------------------------------------------------------------------
-- Lists: fields grouped by row
-- ---------------------------------------------------------------------------

create table if not exists field_lists (
  id               uuid primary key default gen_random_uuid(),
  org_id           text,
  key              text not null check (key ~ '^[a-z][A-Za-z0-9]*$'),
  name             text not null check (length(trim(name)) > 0),
  applies_to       text not null check (applies_to in ('asset', 'property', 'building', 'floor', 'unit')),
  section_id       uuid references sections (id) on delete set null,
  sort_field_key   text,                       -- the column rows are ordered by
  sort_descending  boolean not null default false,
  created_at       timestamptz not null default now()
);
create unique index if not exists field_lists_key_idx on field_lists ((coalesce(org_id, '')), applies_to, key);

-- A list's columns are ordinary fields that point at the list.
alter table field_definitions add column if not exists list_id uuid references field_lists (id) on delete cascade;
-- What a new entry starts with: 'today' or 'currentUser', or nothing.
alter table field_definitions add column if not exists default_value text check (default_value in ('today', 'currentUser'));

-- One row of a list on one record. The row number never changes, so a row can
-- be referred to as, for example, property:120-main-st.comments[2].
create table if not exists field_list_rows (
  id           uuid primary key default gen_random_uuid(),
  org_id       text not null,
  list_id      uuid not null references field_lists (id),
  record_type  text not null check (record_type in ('asset', 'property', 'building', 'floor', 'unit')),
  record_id    uuid not null,
  row_number   int not null,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  removed_by   text,
  removed_at   timestamptz                    -- removed rows are hidden, not deleted, so history is kept
);
create unique index if not exists field_list_rows_number_idx on field_list_rows (list_id, record_id, row_number);
create index if not exists field_list_rows_record_idx on field_list_rows (org_id, record_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'field_values_row_fk') then
    alter table field_values add constraint field_values_row_fk foreign key (row_id) references field_list_rows (id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The Stratios standard layout
-- ---------------------------------------------------------------------------

-- Standard rows have no organization, which the row-level security rules
-- below would refuse. Lift the rules for the table owner while they are
-- added; they are put back at the end of this file.
alter table field_definitions no force row level security;
alter table screens no force row level security;
alter table sections no force row level security;
alter table section_fields no force row level security;
alter table field_lists no force row level security;

insert into screens (key, name, sort_order) values
  ('overview',           'Overview',             10),
  ('financials',         'Financials',           20),
  ('datesAndCommentary', 'Dates and Commentary', 30)
on conflict ((coalesce(org_id, '')), key) do nothing;

insert into sections (screen_id, key, name, applies_to, display_style, sort_order)
select s.id, v.key, v.name, v.applies_to, v.display_style, v.sort_order
from (values
  ('overview',           'assetDetails',    'Asset Details',    'asset',    'form',  10),
  ('overview',           'propertyDetails', 'Property Details', 'property', 'form',  20),
  ('overview',           'buildingDetails', 'Building Details', 'building', 'form',  30),
  ('financials',         'debt',            'Debt',             'asset',    'form',  10),
  ('financials',         'kpis',            'KPIs',             'property', 'tiles', 20),
  ('datesAndCommentary', 'criticalDates',   'Critical Dates',   'asset',    'list',  10),
  ('datesAndCommentary', 'commentary',      'Commentary',       'asset',    'list',  20),
  ('datesAndCommentary', 'criticalDates',   'Critical Dates',   'property', 'list',  10),
  ('datesAndCommentary', 'commentary',      'Commentary',       'property', 'list',  20)
) as v (screen_key, key, name, applies_to, display_style, sort_order)
join screens s on s.org_id is null and s.key = v.screen_key
on conflict ((coalesce(org_id, '')), applies_to, key) do nothing;

-- Place each standard field in the section named after its group.
insert into section_fields (section_id, field_id, position)
select s.id, f.id, f.sort_order
from field_definitions f
join sections s on s.org_id is null and s.applies_to = f.applies_to and s.name = f.group_name
where f.org_id is null and f.list_id is null
on conflict ((coalesce(org_id, '')), section_id, field_id) do nothing;

-- The two standard lists, on both assets and properties.
insert into field_lists (key, name, applies_to, section_id, sort_field_key, sort_descending)
select v.key, v.name, s.applies_to, s.id, v.sort_field_key, v.sort_descending
from (values
  ('criticalDates', 'Critical Dates', 'criticalDates', 'criticalDate', false),
  ('comments',      'Comments',       'commentary',    'commentDate',  true)
) as v (key, name, section_key, sort_field_key, sort_descending)
join sections s on s.org_id is null and s.key = v.section_key
on conflict ((coalesce(org_id, '')), applies_to, key) do nothing;

-- Their columns. Keys are unique within a record type, so each column's key
-- says which list it belongs to.
insert into field_definitions
  (key, name, applies_to, data_type, options, group_name, sort_order, ai_description, other_names, source_priority, list_id, default_value)
select v.key, v.name, l.applies_to, v.data_type, v.options::jsonb, l.name, v.sort_order, v.ai_description, v.other_names::text[],
       '{documents,manual}'::text[], l.id, v.default_value
from (values
  ('criticalDates', 'criticalDate', 'Date', 'date', null, 10,
   'The date something is due or takes effect.', '{"Due Date","Deadline","Effective Date"}', null),
  ('criticalDates', 'criticalDateType', 'Date Type', 'picklist',
   '["Loan Maturity","Lease Expiration","Option Deadline","Rent Step","Insurance Renewal","Tax Deadline","Reporting Deadline","Other"]', 20,
   'What kind of date this is.', '{"Type","Event"}', null),
  ('criticalDates', 'criticalDateDescription', 'Description', 'text', null, 30,
   'What happens on this date and what needs to be done.', '{"Details","Notes"}', null),
  ('criticalDates', 'criticalDateResponsible', 'Responsible Person', 'text', null, 40,
   'Who is responsible for acting on this date.', '{"Owner","Assigned To"}', null),
  ('comments', 'commentDate', 'Date', 'date', null, 10,
   'The date the comment refers to or was made.', '{"As Of","Comment Date"}', 'today'),
  ('comments', 'commentType', 'Comment Type', 'picklist',
   '["General","Leasing","Capital","Financial","Operations","Market","Legal"]', 20,
   'The subject area of the comment.', '{"Type","Category"}', null),
  ('comments', 'comment', 'Comment', 'text', null, 30,
   'The commentary itself.', '{"Commentary","Note","Remarks"}', null),
  ('comments', 'commentMadeBy', 'Made By', 'text', null, 40,
   'Who made the comment.', '{"Author","By"}', 'currentUser')
) as v (list_key, key, name, data_type, options, sort_order, ai_description, other_names, default_value)
join field_lists l on l.org_id is null and l.key = v.list_key
on conflict ((coalesce(org_id, '')), applies_to, key) do nothing;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table field_definitions force row level security;

alter table field_list_rows enable row level security;
alter table field_list_rows force row level security;
drop policy if exists field_list_rows_org_isolation on field_list_rows;
create policy field_list_rows_org_isolation on field_list_rows
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));

-- Layout tables: everyone reads the Stratios standard layout and their own
-- organization's; an organization can only add or change its own.
do $$
declare
  t text;
begin
  foreach t in array array['screens', 'sections', 'section_fields', 'field_lists'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select using (org_id is null or org_id = current_setting(''app.org_id'', true))', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('create policy %I on %I for insert with check (org_id = current_setting(''app.org_id'', true))', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format(
      'create policy %I on %I for update using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))',
      t || '_update', t
    );
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for delete using (org_id = current_setting(''app.org_id'', true))', t || '_delete', t);
  end loop;
end $$;
