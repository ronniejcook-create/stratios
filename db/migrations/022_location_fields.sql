-- Location fields: what public sources say about a property's address.
-- Run after 021_stack_plan.sql. Safe to run more than once.
--
-- 1. A new standard section, Location, on the property's Overview.
-- 2. Eleven standard fields in it: flood zone, flood risk, Special Flood
--    Hazard Area, school district, nearest rail station and its distance,
--    natural hazard rating and the highest hazards, jobs within 1 and 3 miles,
--    and the walkability score. Stratios fills them in by itself whenever a
--    property's address gets, or changes, its place on the map, and again when
--    someone presses Refresh Location.
-- 3. Where an organization already added the same field itself (for example a
--    Flood Zone field the agent proposed from an offering memorandum), its
--    values, history and permissions are moved onto the standard field and its
--    own copy is removed. A same-named field of a different kind is kept and
--    renamed "(Custom)".

-- Row-level rules are lifted for the owner while this runs, so it works for
-- an owner role without BYPASSRLS, and put back at the end. Everything runs
-- as one step: if any part fails, nothing is changed.
begin;

alter table field_definitions no force row level security;
alter table sections no force row level security;
alter table section_fields no force row level security;
alter table field_values no force row level security;
alter table field_value_history no force row level security;
alter table field_source_values no force row level security;
alter table document_findings no force row level security;
alter table field_proposals no force row level security;
alter table field_permissions no force row level security;
alter table field_settings no force row level security;

-- ---------------------------------------------------------------------------
-- 1. Section
-- ---------------------------------------------------------------------------

insert into sections (screen_id, key, name, applies_to, display_style, sort_order)
select s.id, 'location', 'Location', 'property', 'form', 27
from screens s
where s.org_id is null and s.key = 'overview'
on conflict ((coalesce(org_id, '')), applies_to, key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Fields
-- ---------------------------------------------------------------------------

insert into field_definitions
  (key, name, applies_to, data_type, unit, group_name, sort_order, ai_description, source_priority, agent_instructions)
values
  ('floodZone', 'Flood Zone', 'property', 'text', null, 'Location', 10,
   'The FEMA flood zone at the property''s address, as FEMA letters it: X, AE, VE and so on.',
   '{marketData,documents,manual}',
   E'**Also called:** FEMA Flood Zone, FEMA Zone, Flood Zone Designation.\n\nStratios fills this in by itself from FEMA''s National Flood Hazard Layer when the property''s address is placed on the map. From a document, give the zone letters only, for example "X" or "AE"; put a panel number or map date in a comment instead.\n\nPrefer Market Data, then Documents.'),
  ('floodRisk', 'Flood Risk', 'property', 'text', null, 'Location', 20,
   'The flood zone in plain words: Floodway, High Risk, Moderate Risk, Minimal Risk and so on.',
   '{marketData,manual}',
   E'Stratios fills this in by itself from the FEMA flood zone. Do not take it from a document''s own wording.'),
  ('specialFloodHazardArea', 'Special Flood Hazard Area', 'property', 'boolean', null, 'Location', 30,
   'Whether the address is inside a Special Flood Hazard Area, where lenders must require flood insurance.',
   '{marketData,documents,manual}',
   E'**Also called:** SFHA, In a Flood Hazard Area, 100-Year Floodplain.\n\nStratios fills this in by itself from FEMA''s National Flood Hazard Layer. From a document, answer Yes only when it says the property is in a Special Flood Hazard Area or a 100-year floodplain, and No only when it says it is not.'),
  ('schoolDistrict', 'School District', 'property', 'text', null, 'Location', 40,
   'The public school district the property''s address is in.',
   '{marketData,documents,manual}',
   E'**Also called:** ISD, Public School District.\n\nStratios fills this in by itself from the National Center for Education Statistics when the property''s address is placed on the map.'),
  ('nearestRailStation', 'Nearest Rail Station', 'property', 'text', null, 'Location', 50,
   'The closest rail, subway or light rail station within 3 miles of the address, with its kind. Empty when there is none that close.',
   '{marketData,manual}',
   E'Stratios fills this in by itself from the National Transit Map. Do not take it from a document: a brochure names the station it wants to show, not always the nearest.'),
  ('distanceToRailStation', 'Distance to Rail Station', 'property', 'number', 'miles', 'Location', 60,
   'Miles in a straight line from the address to the nearest rail station.',
   '{marketData,manual}',
   E'Stratios fills this in by itself with Nearest Rail Station. Do not take walking or driving distances from a document.'),
  ('naturalHazardRating', 'Natural Hazard Rating', 'property', 'text', null, 'Location', 70,
   'FEMA''s rating of expected yearly loss from all natural hazards together, for the census tract the address is in, from Very Low to Very High. It compares the tract with others and is not a forecast for one building.',
   '{marketData,manual}',
   E'Stratios fills this in by itself from FEMA''s National Risk Index (expected annual loss). Do not take it from a document.'),
  ('highestNaturalHazards', 'Highest Natural Hazards', 'property', 'text', null, 'Location', 80,
   'The natural hazards FEMA rates highest for the census tract the address is in, most serious first, each with its rating.',
   '{marketData,manual}',
   E'Stratios fills this in by itself from FEMA''s National Risk Index. Do not take it from a document.'),
  ('jobsWithin1Mile', 'Jobs Within 1 Mile', 'property', 'number', null, 'Location', 90,
   'The number of jobs located within 1 mile of the address. The counts are the Census Bureau''s for 2017.',
   '{marketData,manual}',
   E'Stratios fills this in by itself from the EPA Smart Location Database, whose job counts are for 2017. Say the year when quoting it. Do not take it from a document.'),
  ('jobsWithin3Miles', 'Jobs Within 3 Miles', 'property', 'number', null, 'Location', 100,
   'The number of jobs located within 3 miles of the address. The counts are the Census Bureau''s for 2017.',
   '{marketData,manual}',
   E'Stratios fills this in by itself from the EPA Smart Location Database, whose job counts are for 2017. Say the year when quoting it. Do not take it from a document.'),
  ('walkabilityScore', 'Walkability Score', 'property', 'number', null, 'Location', 110,
   'The EPA''s walkability score for the block group the address is in, from 1 (least walkable) to 20 (most).',
   '{marketData,manual}',
   E'**Also called:** National Walkability Index.\n\nStratios fills this in by itself from the EPA Smart Location Database. This is not Walk Score, which is a different, licensed measure out of 100; never copy a Walk Score into this field.')
on conflict ((coalesce(org_id, '')), applies_to, key) do nothing;

insert into section_fields (section_id, field_id, position)
select s.id, f.id, f.sort_order
from field_definitions f
join sections s on s.org_id is null and s.applies_to = f.applies_to and s.key = 'location'
where f.org_id is null and f.list_id is null and f.applies_to = 'property'
  and f.key in (
    'floodZone', 'floodRisk', 'specialFloodHazardArea', 'schoolDistrict', 'nearestRailStation', 'distanceToRailStation',
    'naturalHazardRating', 'highestNaturalHazards', 'jobsWithin1Mile', 'jobsWithin3Miles', 'walkabilityScore'
  )
on conflict ((coalesce(org_id, '')), section_id, field_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Fields an organization had already added for itself
-- ---------------------------------------------------------------------------

do $$
declare
  m record;
  new_key text;
  suffix int;
begin
  -- Move an organization's own copy onto the standard field. It counts as the
  -- same field when its key is the standard key or one of the names below and
  -- it holds the same kind of value. One copy per organization and field,
  -- and only while the organization has no values in the standard field yet.
  for m in
    select distinct on (o.org_id, s.id) o.id as old_id, s.id as new_id, o.org_id
    from (values
      ('floodZone', 'floodZone'),
      ('floodZone', 'femaFloodZone'),
      ('floodZone', 'femaZone'),
      ('floodZone', 'floodZoneDesignation'),
      ('specialFloodHazardArea', 'specialFloodHazardArea'),
      ('schoolDistrict', 'schoolDistrict'),
      ('nearestRailStation', 'nearestRailStation'),
      ('walkabilityScore', 'walkabilityScore')
    ) as a (standard_key, other_key)
    join field_definitions s on s.org_id is null and s.applies_to = 'property' and s.key = a.standard_key
    join field_definitions o on o.org_id is not null and o.applies_to = 'property' and lower(o.key) = lower(a.other_key)
    where o.list_id is null and o.retired_at is null and not o.calculated and o.tracking = 'single' and o.core_column is null
      and (case when o.data_type in ('number', 'money', 'percent') then 'n' when o.data_type in ('text', 'picklist') then 't' else o.data_type end)
        = (case when s.data_type in ('number', 'money', 'percent') then 'n' when s.data_type in ('text', 'picklist') then 't' else s.data_type end)
      and not exists (select 1 from field_values v where v.org_id = o.org_id and v.field_id = s.id)
      and not exists (select 1 from field_source_values v where v.org_id = o.org_id and v.field_id = s.id)
    order by o.org_id, s.id, (lower(o.key) = lower(s.key)) desc, o.created_at
  loop
    update field_values set field_id = m.new_id where field_id = m.old_id;
    update field_value_history set field_id = m.new_id where field_id = m.old_id;
    update field_source_values set field_id = m.new_id where field_id = m.old_id;
    update document_findings set field_id = m.new_id where field_id = m.old_id;
    update field_proposals set field_id = m.new_id where field_id = m.old_id;
    update field_permissions set field_id = m.new_id where field_id = m.old_id;
    delete from field_definitions where id = m.old_id;
  end loop;

  -- A field left with the same key as a new standard field (a different kind
  -- of value, or one that was retired) is renamed so the two can be told apart.
  for m in
    select o.id, o.org_id, o.applies_to, o.key, o.name
    from field_definitions o
    join field_definitions s on s.org_id is null and s.applies_to = o.applies_to and lower(s.key) = lower(o.key)
    where o.org_id is not null
  loop
    new_key := m.key || 'Custom';
    suffix := 1;
    while exists (
      select 1 from field_definitions f
      where f.applies_to = m.applies_to and lower(f.key) = lower(new_key) and (f.org_id is null or f.org_id = m.org_id)
    ) loop
      suffix := suffix + 1;
      new_key := m.key || 'Custom' || suffix;
    end loop;
    update field_definitions set key = new_key, name = left(m.name, 180) || ' (Custom)' where id = m.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Put the row-level rules back
-- ---------------------------------------------------------------------------

alter table field_definitions force row level security;
alter table sections force row level security;
alter table section_fields force row level security;
alter table field_values force row level security;
alter table field_value_history force row level security;
alter table field_source_values force row level security;
alter table document_findings force row level security;
alter table field_proposals force row level security;
alter table field_permissions force row level security;
alter table field_settings force row level security;

commit;
