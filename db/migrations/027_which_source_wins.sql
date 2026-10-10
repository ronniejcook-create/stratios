-- Which source wins, as a skill.
-- Run after 026_kpis_from_leases.sql. Safe to run more than once.
--
-- When a document is read, or KPIs are calculated, a value can differ from
-- the one a field already holds. What happens then (replace it, ask a
-- person, or keep what is there) is now decided by a skill the agents
-- follow, written in plain words, instead of by each field's drop-downs.
-- An organization can edit it in its Skills Library. Where the skill says
-- nothing about a case, the field's own settings still decide.
--
-- No table changes: this adds one standard skill.

begin;

alter table skills no force row level security;

insert into skills (key, name, use_when, instructions, created_by, updated_by)
select 'which-source-wins', 'Which Source Wins',
  'Always, whenever a value read from a document or calculated from leases differs from the value a field already holds. It says whether the new value replaces the old one, a person is asked, or the old one is kept.',
  E'### What This Decides\nA field holds one value. When a document or a calculation gives a different one, exactly one of three things happens:\n- **Replace:** the new value takes its place without asking. The old value stays in the field''s history.\n- **Ask:** the new value waits in review for a person to choose.\n- **Keep:** the value on record stays. The new one is noted but not used.\n\nYou are shown what each field holds now and where that came from: typed by a person, taken from a document (with the document''s kind and date), calculated, or looked up.\n\n### The General Rules\n1. **A value a person typed stays.** Ask; never replace it. A person had a reason.\n2. **A current source beats a one-time source.** Some documents describe a property once (an offering memorandum, an appraisal). Others are loaded again and again and say how things stand now (a rent roll, an operating statement). For figures that change over time, the current source replaces the one-time one.\n3. **Newer beats older, for the same kind of document.** A later rent roll replaces an earlier rent roll. An earlier one never replaces a later one: keep.\n4. **Each kind of document is trusted for its own subject**, set out below. Outside its subject it does not replace anything: ask.\n5. **When these rules do not settle it, ask.**\n\n### Rent Rolls\nA rent roll is the current source for leasing figures: Occupancy Rate, Percent Leased, Number of Tenants, Weighted Average Lease Term, Average Rent per Square Foot, Total Rentable Square Feet, Leased and Vacant Square Feet, Annual Base Rent, unit counts and in-place rents.\n- It **replaces** those figures where they came from an offering memorandum, an appraisal or an earlier rent roll.\n- It **keeps** what is there when the value on record came from a rent roll with a later date.\n- It never replaces a purchase price, a value, a loan term, an underwriting assumption or a description: ask.\n\n### Offering Memorandums\nA memorandum is a one-time picture, written to sell. It is the source for descriptions, the investment summary and underwriting assumptions.\n- It **keeps** leasing figures that came from a rent roll or were calculated from leases, and revenue, expense and income figures that came from an operating statement.\n- It **replaces** an earlier memorandum''s values for the same property.\n- Anything else that differs: ask.\n\n### Operating Statements\nAn operating statement is the current source for Total Revenue, Operating Expenses and Net Operating Income, month by month.\n- It **replaces** those figures for the same month where they came from an offering memorandum, an appraisal or an earlier statement.\n- Outside those figures: ask.\n\n### Appraisals\nAn appraisal is the source for value: Current Value and the cap rate it concludes.\n- It **replaces** a value that came from an offering memorandum or an earlier appraisal.\n- It **keeps** leasing figures that came from a rent roll, and income figures that came from an operating statement.\n\n### Values Calculated From Leases\nA figure calculated from the stored leases stands for the rent roll it was calculated from.\n- It **replaces** a figure that came from an offering memorandum, an appraisal, an earlier rent roll, or an earlier calculation.\n- It **keeps** a figure the latest rent roll itself shows: what the page says wins over arithmetic.\n- A value a person typed: ask.\n\n### Values Looked Up From Public Sources\nFlood zone, school district and the other location figures are looked up from public sources.\n- A document that states a different one: ask.',
  'stratios', 'stratios'
where not exists (select 1 from skills s where s.org_id is null and s.key = 'which-source-wins');

alter table skills force row level security;

commit;
