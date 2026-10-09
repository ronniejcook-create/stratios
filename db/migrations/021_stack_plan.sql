-- Stack plan: each rent roll row can carry the floor its suite is on.
-- Also adds two parts to the standard "Reading a Rent Roll" skill, so the
-- rules can be changed in the Skills Library: how to work out a floor, and
-- what to do when a property has more than one rent roll for the same date.
-- Run after 020_rent_roll_skill.sql. Safe to run more than once. An
-- organization's own edited copy of the skill is not touched.

begin;

-- The level number: 1 is the ground floor, basements are negative.
alter table rent_roll_rows add column if not exists floor int;
-- True when the document does not show the floor and it was worked out, for example from the suite number.
alter table rent_roll_rows add column if not exists floor_inferred boolean not null default false;

alter table skills no force row level security;

update skills
set instructions = instructions || E'\n\n### Floors\n- If the rent roll shows which floor a suite is on, use it.\n- If it does not, work the floor out from the suite number: for a three-digit suite the first digit is the floor (suite 501 is on floor 5); for a four-digit suite the first two digits are (suite 1205 is on floor 12).\n- When a row lists several suites, use the first one.\n- Leave the floor empty when the suite is not a number (JAN, MAINT, VEN), is a letter, or when a number that small would not make sense for the building.\n- A basement is a negative floor (B1 is -1). The ground floor is 1.',
    updated_at = now()
where org_id is null and key = 'reading-a-rent-roll'
  and position('### Floors' in instructions) = 0;

update skills
set instructions = instructions || E'\n\n### More Than One Rent Roll for the Same Date\n- A mixed-use building can have two rent rolls for one date, for example retail on the ground floor and residential above. Each is saved as its own snapshot.\n- Only one of them supplies the property''s values. The **main** rent roll is the one with the most rows.\n- You are told which rent rolls are already saved for the property, with their dates and row counts. If one of them is for the same date as this document and has as many rows or more, this document is **secondary**; otherwise it is **main**.',
    updated_at = now()
where org_id is null and key = 'reading-a-rent-roll'
  and position('### More Than One Rent Roll for the Same Date' in instructions) = 0;

alter table skills force row level security;

commit;
