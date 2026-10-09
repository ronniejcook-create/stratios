-- Moves the rules for reading a rent roll into the "Reading a Rent Roll"
-- skill, so they can be read and changed in the Skills Library instead of
-- being fixed inside the app: how rows are copied, what counts as Leased,
-- Vacant or Not for Lease, how dates are read, and the check against the
-- document's own totals.
-- Run after 019_rent_rolls.sql. Safe to run more than once: it rewrites the
-- standard skill only while it does not yet have these parts. An
-- organization's own edited copy of the skill is not touched.

begin;

alter table skills no force row level security;

update skills
set use_when = 'The document is a rent roll, or contains a rent roll table: a list of a property''s suites or units with their tenants, areas, rents and lease dates.',
    instructions = E'### What This Document Is\nA snapshot of who leases what on one date (the "as of" date). Stratios saves its rows as a dated rent roll and fills in the property''s values from it.\n\n### Copying the Rows\n- Give one row for each suite or unit line, in the document''s order, with vacant space included.\n- Copy every figure exactly as shown. Leave a cell empty when the document leaves it empty. Never work out a rent, an area or a date for a row.\n- Leave out total, subtotal and summary lines.\n- Rent steps are the future rent changes listed for a lease, not its current rent.\n\n### Leased, Vacant or Not for Lease\n- **Leased:** a tenant holds the space.\n- A row with lease dates but no rent, such as a management office, an amenity lounge, storage, janitor, maintenance or vending space, is **Leased**, unless the document''s own totals count it another way.\n- **Vacant:** space the document shows as available to lease.\n- **Not for Lease:** only space the document itself sets apart and totals separately, such as space it marks as static.\n- Before answering, check that the rows you marked Leased add up to the leased total the document shows, and the rows you marked Vacant to its vacant or available total. If they do not, look again at the rows you marked Not for Lease.\n\n### Dates\n- When a lease date is shown only as a month and year, use the first day of the month for a lease start or a rent step, and the last day of the month for a lease end.\n- The as of date is the date the rent roll says it is as of. If the document does not state one, leave it empty; never use today''s date or the date of the file.\n- Use the as of date''s month for every value tracked per month.\n\n### Totals and Values\n- Where the rent roll shows a total or summary figure (total square feet, leased or occupied square feet, vacant square feet, occupancy, number of tenants), take it exactly as shown.\n- Do not return tenant-by-tenant or suite-by-suite figures as field values; those belong in the rows.\n- Add a critical date for each lease expiration in the next 24 months, naming the tenant and the suite.\n\n### Values to Calculate\nWhen the rent roll does not show them, calculate these from its rows, each by its field''s "How to Calculate":\n- Occupancy Rate\n- Percent Leased\n- Number of Tenants\n- Weighted Average Lease Term\n- Average Rent per Square Foot\n- Total Rentable Square Feet\n\n### What to Mention in the Summary\n- The as of date, or that the document states none.\n- Which values were calculated rather than shown.\n- Any rows you were unsure how to mark, and anything that made a calculation uncertain, such as missing areas or lease dates.',
    updated_at = now()
where org_id is null and key = 'reading-a-rent-roll'
  and position('### Leased, Vacant or Not for Lease' in instructions) = 0;

alter table skills force row level security;

commit;
