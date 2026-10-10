-- Property types and subtypes, and drop-down lists that can be managed.
-- Run after 022_location_fields.sql. Safe to run more than once.
--
-- 1. A field can depend on another (field_definitions.depends_on): its choices
--    follow what the other field holds, as a subtype follows its type.
-- 2. The standard Property Type list becomes NCREIF's eight property types
--    (Office, Industrial, Retail, Residential, Hotel, Self-Storage, Seniors
--    Housing, Other) plus Mixed Use. Each choice now has a permanent key behind
--    its name. "Multifamily" is renamed "Residential" wherever it is stored;
--    the old name is remembered, so nothing is lost.
-- 3. A new standard field, Property Subtype, with NCREIF's subtypes, each tied
--    to its property type.
--
-- Row-level rules are lifted for the owner while this runs, so it works for
-- an owner role without BYPASSRLS, and put back at the end. Everything runs
-- as one step: if any part fails, nothing is changed.
begin;

alter table field_definitions add column if not exists depends_on text;

alter table field_definitions no force row level security;
alter table section_fields no force row level security;
alter table field_values no force row level security;
alter table field_source_values no force row level security;
alter table properties no force row level security;

-- ---------------------------------------------------------------------------
-- 1. Property Type: NCREIF's list, with a key behind each name
-- ---------------------------------------------------------------------------

-- Only while the list is still the old one (plain names); a list Stratios has
-- since edited on the Fields Library screen is left as it is.
update field_definitions
set options = '[
      {"key": "office",         "label": "Office"},
      {"key": "industrial",     "label": "Industrial"},
      {"key": "retail",         "label": "Retail"},
      {"key": "residential",    "label": "Residential", "aliases": ["Multifamily"]},
      {"key": "hotel",          "label": "Hotel"},
      {"key": "selfStorage",    "label": "Self-Storage"},
      {"key": "seniorsHousing", "label": "Seniors Housing"},
      {"key": "mixedUse",       "label": "Mixed Use"},
      {"key": "other",          "label": "Other"}
    ]'::jsonb,
    ai_description = 'The main use of the property, by NCREIF''s property types, plus Mixed Use.'
where org_id is null and applies_to = 'property' and key = 'propertyType'
  and jsonb_typeof(options -> 0) = 'string';

update field_definitions
set agent_instructions = coalesce(agent_instructions || E'\n\n', '') ||
      E'### Choosing the Type\nUse the property''s main use. Apartments and other housing are Residential. A property with several uses is Mixed Use only when no one use is clearly the main one; otherwise choose the use that makes up most of its value.'
where org_id is null and applies_to = 'property' and key = 'propertyType'
  and position('### Choosing the Type' in coalesce(agent_instructions, '')) = 0;

-- "Multifamily" becomes "Residential" where it is stored. History keeps the name used at the time.
update properties set property_type = 'Residential' where property_type = 'Multifamily';
update field_values v set value_text = 'Residential'
from field_definitions f
where f.id = v.field_id and f.org_id is null and f.applies_to = 'property' and f.key = 'propertyType' and v.value_text = 'Multifamily';
update field_source_values v set value_text = 'Residential'
from field_definitions f
where f.id = v.field_id and f.org_id is null and f.applies_to = 'property' and f.key = 'propertyType' and v.value_text = 'Multifamily';

-- ---------------------------------------------------------------------------
-- 2. Property Subtype
-- ---------------------------------------------------------------------------

-- An organization's own field with the same key is renamed so the two can be told apart.
do $$
declare
  m record;
  new_key text;
  suffix int;
begin
  for m in
    select o.id, o.org_id, o.applies_to, o.key, o.name
    from field_definitions o
    where o.org_id is not null and o.applies_to = 'property' and lower(o.key) = 'propertysubtype'
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

insert into field_definitions
  (key, name, applies_to, data_type, unit, options, depends_on, group_name, sort_order, ai_description, source_priority, agent_instructions)
values
  ('propertySubtype', 'Property Subtype', 'property', 'picklist', null,
   '[
      {"key": "cbd",                       "label": "CBD",                        "parent": "office"},
      {"key": "urban",                     "label": "Urban",                      "parent": "office"},
      {"key": "secondaryBusinessDistrict", "label": "Secondary Business District", "parent": "office"},
      {"key": "suburban",                  "label": "Suburban",                   "parent": "office"},
      {"key": "medicalOffice",             "label": "Medical Office",             "parent": "office"},
      {"key": "officeLifeScience",         "label": "Life Science",               "parent": "office"},
      {"key": "warehouse",                 "label": "Warehouse",                  "parent": "industrial"},
      {"key": "manufacturing",             "label": "Manufacturing",              "parent": "industrial"},
      {"key": "flex",                      "label": "Flex",                       "parent": "industrial"},
      {"key": "industrialLifeScience",     "label": "Life Science",               "parent": "industrial"},
      {"key": "specialized",               "label": "Specialized",                "parent": "industrial"},
      {"key": "mall",                      "label": "Mall",                       "parent": "retail"},
      {"key": "street",                    "label": "Street",                     "parent": "retail"},
      {"key": "strip",                     "label": "Strip",                      "parent": "retail"},
      {"key": "apartment",                 "label": "Apartment",                  "parent": "residential"},
      {"key": "studentHousing",            "label": "Student Housing",            "parent": "residential"},
      {"key": "manufacturedHousing",       "label": "Manufactured Housing",       "parent": "residential"},
      {"key": "singleFamilyRental",        "label": "Single-Family Rental",       "parent": "residential"},
      {"key": "fullService",               "label": "Full Service",               "parent": "hotel"},
      {"key": "limitedService",            "label": "Limited Service",            "parent": "hotel"},
      {"key": "independentLiving",         "label": "Independent Living",         "parent": "seniorsHousing"},
      {"key": "assistedLiving",            "label": "Assisted Living",            "parent": "seniorsHousing"},
      {"key": "continuingCare",            "label": "Continuing Care Retirement Community", "parent": "seniorsHousing"},
      {"key": "skilledNursing",            "label": "Skilled Nursing",            "parent": "seniorsHousing"},
      {"key": "dataCenter",                "label": "Data Center",                "parent": "other"},
      {"key": "entertainment",             "label": "Entertainment",              "parent": "other"},
      {"key": "operatingLand",             "label": "Operating Land",             "parent": "other"},
      {"key": "parking",                   "label": "Parking",                    "parent": "other"},
      {"key": "otherSubtype",              "label": "Other",                      "parent": "other"}
    ]'::jsonb,
   'propertyType', 'Property Details', 25,
   'The kind of property within its type, by NCREIF''s subtypes: for example Medical Office within Office, or Warehouse within Industrial.',
   '{manual,documents}',
   E'**Also called:** Subtype, Sub-Type, Property Sub-Type, Asset Subtype.\n\nChoose only a subtype listed for the property''s Property Type, and only when the document makes it clear; otherwise leave it empty. For Office, CBD, Urban, Secondary Business District and Suburban describe where the building is; Medical Office and Life Science describe what it is used for and come first when they apply. Self-Storage and Mixed Use have no subtypes.')
on conflict ((coalesce(org_id, '')), applies_to, key) do nothing;

insert into section_fields (section_id, field_id, position)
select s.id, f.id, f.sort_order
from field_definitions f
join sections s on s.org_id is null and s.applies_to = 'property' and s.key = 'propertyDetails'
where f.org_id is null and f.applies_to = 'property' and f.key = 'propertySubtype'
on conflict ((coalesce(org_id, '')), section_id, field_id) do nothing;

-- ---------------------------------------------------------------------------
-- Put the row-level rules back
-- ---------------------------------------------------------------------------

alter table field_definitions force row level security;
alter table section_fields force row level security;
alter table field_values force row level security;
alter table field_source_values force row level security;
alter table properties force row level security;

commit;
