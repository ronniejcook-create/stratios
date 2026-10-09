-- More Stratios standard fields, and guidance for commentary from documents.
-- Run after 016_starting_value_history.sql. Safe to run more than once.
--
-- 1. Three new standard sections: Investment Summary (asset) and Property
--    Summary (property) on Overview, and Underwriting (property) on Financials.
-- 2. Twenty-two new standard fields: narrative summaries, more property and
--    building facts, and underwriting assumptions.
-- 3. Where an organization already added the same field itself (usually from
--    a field the agent proposed), its values, history and permissions are
--    moved onto the new standard field and its own copy is removed, so the
--    field does not show twice. A same-named field of a different kind is
--    kept and renamed "(Custom)".
-- 4. The standard "Reading an Offering Memorandum" skill gains a part about
--    commentary and critical dates.

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
alter table skills no force row level security;

-- ---------------------------------------------------------------------------
-- 1. Sections
-- ---------------------------------------------------------------------------

insert into sections (screen_id, key, name, applies_to, display_style, sort_order)
select s.id, v.key, v.name, v.applies_to, 'form', v.sort_order
from (values
  ('overview',   'investmentSummary', 'Investment Summary', 'asset',    15),
  ('overview',   'propertySummary',   'Property Summary',   'property', 25),
  ('financials', 'underwriting',      'Underwriting',       'property', 30)
) as v (screen_key, key, name, applies_to, sort_order)
join screens s on s.org_id is null and s.key = v.screen_key
on conflict ((coalesce(org_id, '')), applies_to, key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Fields
-- ---------------------------------------------------------------------------

insert into field_definitions
  (key, name, applies_to, data_type, unit, group_name, sort_order, ai_description, source_priority, agent_instructions)
values
  -- Investment Summary (asset)
  ('investmentHighlights', 'Investment Highlights', 'asset', 'text', null, 'Investment Summary', 10,
   'The main reasons the investment is attractive, as a short paragraph.',
   '{documents,manual}',
   E'**Also called:** Investment Summary, Executive Summary, Offering Highlights, Key Highlights.\n\nSummarize the document''s own highlights in plain sentences, 100 words or fewer. Keep facts and figures exactly as stated and leave out sales language.'),
  ('businessPlan', 'Business Plan', 'asset', 'text', null, 'Investment Summary', 20,
   'What the owner intends to do with the asset: hold, lease up, renovate, reposition or sell.',
   '{manual,documents}',
   E'**Also called:** Investment Strategy, Value-Add Plan, Strategy, Exit Strategy.\n\nSummarize in 100 words or fewer. In an offering memorandum this is the plan the seller suggests to a buyer, not the owner''s own plan; begin with "Seller''s suggested plan:" in that case.'),

  -- Property Summary (property)
  ('propertyDescription', 'Property Description', 'property', 'text', null, 'Property Summary', 10,
   'What the property is: its buildings, size, age, condition and notable features.',
   '{documents,manual}',
   E'**Also called:** Property Overview, Building Description, Improvements.\n\nSummarize in plain sentences, 100 words or fewer, from the property overview or description pages. Facts only, as the document states them.'),
  ('locationDescription', 'Location Description', 'property', 'text', null, 'Property Summary', 20,
   'Where the property is and what is around it: access, transit, neighbors and what drives demand.',
   '{documents,manual}',
   E'**Also called:** Location Overview, Area Overview, Market Overview, Neighborhood.\n\nSummarize in plain sentences, 100 words or fewer. Name the roads, transit and nearby places the document names.'),
  ('tenancySummary', 'Tenancy Summary', 'property', 'text', null, 'Property Summary', 30,
   'Who occupies the property: the main tenants, how much they lease and when their leases run out.',
   '{documents,propertyManagementSystem,manual}',
   E'**Also called:** Tenant Overview, Tenancy Overview, Rent Roll Summary, Major Tenants.\n\nSummarize in plain sentences, 100 words or fewer: how many tenants, the largest by area, and the nearest large lease expirations.'),

  -- Property Details (property)
  ('county', 'County', 'property', 'text', null, 'Property Details', 100,
   'The county the property is in.',
   '{documents,manual}',
   E'Give the county''s name alone, without the word "County".'),
  ('zoning', 'Zoning', 'property', 'text', null, 'Property Details', 110,
   'The zoning designation of the site, as the local authority names it.',
   '{documents,manual}',
   E'**Also called:** Zoning District, Zoning Classification.\n\nGive the code and, when stated, its meaning in brackets, for example "MU-1 (Mixed Use)".'),
  ('parkingRatio', 'Parking Ratio', 'property', 'text', null, 'Property Details', 120,
   'Parking spaces for every 1,000 square feet of rentable area, written the way the document states it.',
   '{documents,manual}',
   E'Write it as stated, for example "3.5 / 1,000 SF". Do not calculate it from the number of spaces.'),
  ('surfaceParkingSpaces', 'Surface Parking Spaces', 'property', 'number', null, 'Property Details', 130,
   'The number of open-air parking spaces on the site.',
   '{documents,manual}',
   E'**Also called:** Surface Spaces, Surface Lot Spaces.'),
  ('garageParkingSpaces', 'Garage Parking Spaces', 'property', 'number', null, 'Property Details', 140,
   'The number of parking spaces in a garage or other covered structure.',
   '{documents,manual}',
   E'**Also called:** Structured Parking Spaces, Covered Parking Spaces, Garage Spaces.'),
  ('numberOfTenants', 'Number of Tenants', 'property', 'number', null, 'Property Details', 150,
   'How many tenants hold leases at the property.',
   '{propertyManagementSystem,documents,manual}',
   E'**Also called:** Tenant Count, Tenants.\n\nUse the number the document states. Do not count rows in a rent roll.'),
  ('percentLeased', 'Percent Leased', 'property', 'percent', null, 'Property Details', 160,
   'The share of rentable area under signed leases. It can be higher than Occupancy Rate, which counts only space tenants have moved into.',
   '{propertyManagementSystem,documents,manual}',
   E'**Also called:** Leased, % Leased, Leased Percentage.\n\nIf the document gives only "occupancy", use Occupancy Rate instead and leave this empty.'),
  ('weightedAverageLeaseTerm', 'Weighted Average Lease Term', 'property', 'number', 'years', 'Property Details', 170,
   'The average time left on the property''s leases, weighted by area or rent, in years.',
   '{documents,propertyManagementSystem,manual}',
   E'**Also called:** WALT, WALE, Weighted Average Lease Term Remaining, Weighted Average Remaining Lease Term.\n\nGive years. If the document states months, divide by 12 and lower the confidence.'),

  -- Building Details (building)
  ('constructionType', 'Construction Type', 'building', 'text', null, 'Building Details', 50,
   'How the building is built: its structure and exterior, for example steel frame with a glass curtain wall.',
   '{documents,manual}',
   E'**Also called:** Construction, Structure, Exterior, Facade.'),
  ('roofType', 'Roof', 'building', 'text', null, 'Building Details', 60,
   'The type of roof and, when known, its age or the year it was replaced.',
   '{documents,manual}',
   E'**Also called:** Roof Type, Roofing, Roof System.'),
  ('hvacSystem', 'HVAC', 'building', 'text', null, 'Building Details', 70,
   'The heating and cooling system, and its age when known.',
   '{documents,manual}',
   E'**Also called:** HVAC System, Mechanical, Heating and Cooling.'),
  ('elevatorCount', 'Elevators', 'building', 'number', null, 'Building Details', 80,
   'The number of elevators in the building, passenger and freight together.',
   '{documents,manual}',
   E'**Also called:** Elevator Count, Number of Elevators.'),
  ('typicalFloorPlate', 'Typical Floor Plate', 'building', 'number', 'SF', 'Building Details', 90,
   'The rentable area of a typical floor.',
   '{documents,manual}',
   E'**Also called:** Average Floor Plate, Floor Plate, Typical Floor Size.\n\nIf a range is given, use its midpoint and lower the confidence.'),
  ('ceilingHeight', 'Ceiling Height', 'building', 'text', null, 'Building Details', 100,
   'The ceiling or clear height, written the way the document states it.',
   '{documents,manual}',
   E'**Also called:** Clear Height, Slab-to-Slab Height, Finished Ceiling Height.\n\nSay which kind of height it is, for example "9 ft finished" or "32 ft clear".'),

  -- Underwriting (property)
  ('inPlaceNetOperatingIncome', 'In-Place Net Operating Income', 'property', 'money', 'USD', 'Underwriting', 10,
   'Annual net operating income from the leases in place today, as one stated figure. The monthly Net Operating Income field holds the actual figure for each month.',
   '{documents,manual}',
   E'**Also called:** In-Place NOI, Year 1 NOI, Current NOI.\n\nUse the in-place figure, not a pro forma or stabilized one. Say in the summary which year or period it covers.'),
  ('vacancyAssumption', 'Vacancy Assumption', 'property', 'percent', null, 'Underwriting', 20,
   'The vacancy and credit loss allowance used in the financial projections.',
   '{documents,manual}',
   E'**Also called:** General Vacancy, Vacancy Allowance, Vacancy and Credit Loss.\n\nThis is an assumption for projections, not the property''s actual vacancy.'),
  ('capitalReservePerSquareFoot', 'Capital Reserve per Square Foot', 'property', 'money', 'USD per SF', 'Underwriting', 30,
   'The yearly amount set aside for capital repairs in the financial projections, for each rentable square foot.',
   '{documents,manual}',
   E'**Also called:** Capital Reserves, Replacement Reserves, Reserves per SF.')
on conflict ((coalesce(org_id, '')), applies_to, key) do nothing;

-- Place each new field in the section named after its group.
insert into section_fields (section_id, field_id, position)
select s.id, f.id, f.sort_order
from field_definitions f
join sections s on s.org_id is null and s.applies_to = f.applies_to and s.name = f.group_name
where f.org_id is null and f.list_id is null
  and f.key in (
    'investmentHighlights', 'businessPlan', 'propertyDescription', 'locationDescription', 'tenancySummary',
    'county', 'zoning', 'parkingRatio', 'surfaceParkingSpaces', 'garageParkingSpaces', 'numberOfTenants', 'percentLeased',
    'weightedAverageLeaseTerm', 'constructionType', 'roofType', 'hvacSystem', 'elevatorCount', 'typicalFloorPlate',
    'ceilingHeight', 'inPlaceNetOperatingIncome', 'vacancyAssumption', 'capitalReservePerSquareFoot'
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
      ('property', 'county', 'county'),
      ('property', 'zoning', 'zoning'),
      ('property', 'parkingRatio', 'parkingRatio'),
      ('property', 'surfaceParkingSpaces', 'surfaceParkingSpaces'),
      ('property', 'garageParkingSpaces', 'garageParkingSpaces'),
      ('property', 'garageParkingSpaces', 'structuredParkingSpaces'),
      ('property', 'garageParkingSpaces', 'coveredParkingSpaces'),
      ('property', 'numberOfTenants', 'numberOfTenants'),
      ('property', 'numberOfTenants', 'tenantCount'),
      ('property', 'percentLeased', 'percentLeased'),
      ('property', 'percentLeased', 'leasedPercentage'),
      ('property', 'weightedAverageLeaseTerm', 'weightedAverageLeaseTerm'),
      ('property', 'weightedAverageLeaseTerm', 'weightedAverageLeaseTermRemaining'),
      ('property', 'weightedAverageLeaseTerm', 'weightedAverageRemainingLeaseTerm'),
      ('property', 'weightedAverageLeaseTerm', 'walt'),
      ('property', 'inPlaceNetOperatingIncome', 'inPlaceNetOperatingIncome'),
      ('property', 'inPlaceNetOperatingIncome', 'inPlaceNoi'),
      ('property', 'vacancyAssumption', 'vacancyAssumption'),
      ('property', 'vacancyAssumption', 'generalVacancyAssumption'),
      ('property', 'vacancyAssumption', 'generalVacancy'),
      ('property', 'capitalReservePerSquareFoot', 'capitalReservePerSquareFoot'),
      ('property', 'capitalReservePerSquareFoot', 'capitalReservePerSf'),
      ('property', 'capitalReservePerSquareFoot', 'capitalReservesPerSf'),
      ('property', 'propertyDescription', 'propertyDescription'),
      ('property', 'locationDescription', 'locationDescription'),
      ('property', 'tenancySummary', 'tenancySummary'),
      ('asset', 'investmentHighlights', 'investmentHighlights'),
      ('asset', 'businessPlan', 'businessPlan'),
      ('building', 'constructionType', 'constructionType'),
      ('building', 'roofType', 'roofType'),
      ('building', 'roofType', 'roof'),
      ('building', 'hvacSystem', 'hvacSystem'),
      ('building', 'hvacSystem', 'hvac'),
      ('building', 'elevatorCount', 'elevatorCount'),
      ('building', 'elevatorCount', 'elevators'),
      ('building', 'elevatorCount', 'numberOfElevators'),
      ('building', 'typicalFloorPlate', 'typicalFloorPlate'),
      ('building', 'typicalFloorPlate', 'averageFloorPlate'),
      ('building', 'typicalFloorPlate', 'floorPlate'),
      ('building', 'ceilingHeight', 'ceilingHeight')
    ) as a (applies_to, standard_key, other_key)
    join field_definitions s on s.org_id is null and s.applies_to = a.applies_to and s.key = a.standard_key
    join field_definitions o on o.org_id is not null and o.applies_to = a.applies_to and lower(o.key) = lower(a.other_key)
    where o.list_id is null and o.retired_at is null and not o.calculated and o.tracking = 'single' and o.core_column is null
      and (case when o.data_type in ('number', 'money', 'percent') then 'n' when o.data_type in ('text', 'picklist') then 't' else o.data_type end)
        = (case when s.data_type in ('number', 'money', 'percent') then 'n' when s.data_type in ('text', 'picklist') then 't' else s.data_type end)
      -- Never onto a standard field the organization already has values in.
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
    -- The organization's own placement of its field is dropped, so the field
    -- takes its standard place. Its settings go with the field itself.
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
-- 4. The offering memorandum skill: commentary and critical dates
-- ---------------------------------------------------------------------------

update skills
set instructions = instructions || E'\n\n### Commentary and Critical Dates\n- Add comments for the narrative a new owner would want on file: investment highlights, location and market, tenancy and leasing, building condition and capital work, financial points, and the risks or assumptions the seller flags. One comment per topic, in plain words.\n- Comments about the deal as a whole go on the asset. Comments about the building, its tenants or its location go on the property.\n- Add a critical date for each lease expiration, renewal or termination option deadline, rent step and loan maturity the document gives a date for. Name the tenant or loan in the description.\n- Use the memorandum''s date as the comment date and the brokerage as who made the comment.',
    updated_at = now()
where org_id is null and key = 'reading-an-offering-memorandum'
  and position('### Commentary and Critical Dates' in instructions) = 0;

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
alter table skills force row level security;

commit;
