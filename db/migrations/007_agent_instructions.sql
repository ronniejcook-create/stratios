-- Agent Instructions: one block of Markdown per field that the agents read
-- like a skill. It replaces the separate Other Names, Extraction Hints and
-- Source Priority boxes on the Fields and Layout screen.
-- Run after 006_master_library.sql. Safe to run more than once.
--
-- The old columns (other_names, extraction_hints, source_priority) are kept,
-- untouched, so nothing is lost. The first time this file runs, what they
-- held is written into each field's Agent Instructions as a starting point.
-- Later runs change nothing, so instructions edited or cleared since then
-- are never overwritten.

do $$
declare
  first_run boolean;
begin
  select not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'field_definitions' and column_name = 'agent_instructions'
  ) into first_run;

  if not first_run then
    return;
  end if;

  alter table field_definitions add column agent_instructions text;

  -- Builds the starting text from the three old settings.
  create function pg_temp.starting_instructions(names text[], hints text, priority text[], is_calculated boolean)
  returns text language sql as $f$
    select nullif(concat_ws(E'\n\n',
      case when coalesce(array_length(names, 1), 0) > 0 then
        E'### Other Names\n' || (select string_agg('- ' || n, E'\n' order by i) from unnest(names) with ordinality as x (n, i))
      end,
      case when nullif(btrim(coalesce(hints, '')), '') is not null then
        E'### Where to Find It\n' || btrim(hints)
      end,
      case when not is_calculated and coalesce(array_length(priority, 1), 0) > 0 then
        E'### Source Priority\nWhen sources disagree, prefer them in this order:\n' ||
        (select string_agg(i || '. ' || coalesce(s.name, p), E'\n' order by i)
         from unnest(priority) with ordinality as x (p, i) left join source_types s on s.key = x.p)
      end
    ), '')
  $f$;

  -- Rows belong to every organization (and to none, for the standard), which
  -- the row-level security rules would hide. Lift them for the table owner
  -- while the text is filled in; they are put back below.
  alter table field_definitions no force row level security;
  alter table field_settings no force row level security;

  update field_definitions
  set agent_instructions = pg_temp.starting_instructions(other_names, extraction_hints, source_priority, calculated);

  -- Where an organization had changed any of the three old settings on a
  -- standard field, its own version becomes its own Agent Instructions.
  insert into field_settings (org_id, field_id, setting, value, modified_by, modified_at)
  select o.org_id, o.field_id, 'agent_instructions', to_jsonb(o.instructions), o.modified_by, o.modified_at
  from (
    select s.org_id, s.field_id, max(s.modified_by) as modified_by, max(s.modified_at) as modified_at,
           pg_temp.starting_instructions(
             coalesce(
               (select array_agg(e.v order by e.i)
                from field_settings n, jsonb_array_elements_text(n.value) with ordinality as e (v, i)
                where n.org_id = s.org_id and n.field_id = s.field_id and n.setting = 'other_names' and jsonb_typeof(n.value) = 'array'),
               case when bool_or(s.setting = 'other_names') then '{}'::text[] else d.other_names end),
             case when bool_or(s.setting = 'extraction_hints')
               then (select n.value #>> '{}' from field_settings n where n.org_id = s.org_id and n.field_id = s.field_id and n.setting = 'extraction_hints')
               else d.extraction_hints end,
             coalesce(
               (select array_agg(e.v order by e.i)
                from field_settings n, jsonb_array_elements_text(n.value) with ordinality as e (v, i)
                where n.org_id = s.org_id and n.field_id = s.field_id and n.setting = 'source_priority' and jsonb_typeof(n.value) = 'array'),
               d.source_priority),
             d.calculated
           ) as instructions
    from field_settings s
    join field_definitions d on d.id = s.field_id and d.org_id is null
    where s.setting in ('other_names', 'extraction_hints', 'source_priority')
    group by s.org_id, s.field_id, d.other_names, d.extraction_hints, d.source_priority, d.calculated
  ) o
  where o.instructions is not null
  on conflict (org_id, field_id, setting) do nothing;

  alter table field_definitions force row level security;
  alter table field_settings force row level security;
end $$;
