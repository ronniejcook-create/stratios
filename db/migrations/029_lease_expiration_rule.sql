-- Reading a Lease: an expiration date the lease does not print.
-- Run after 028_lease_fields.sql. Safe to run more than once.
--
-- Many leases give a commencement date and a term ("38 months") and leave the
-- commencement memorandum blank, so no expiration date is printed anywhere.
-- The standard skill told the agent never to work a date out, which left
-- Expiration Date empty on such a lease. It now may, when both inputs are
-- fixed, and must say so. An organization's edited copy is not touched.

begin;

alter table skills no force row level security;

update skills
set instructions = replace(
      instructions,
      E'- Copy dates and dollar figures exactly as written. Never estimate a date the lease leaves to a formula; leave it empty and say so in the summary.',
      E'- Copy dates and dollar figures exactly as written. Never estimate a date the lease leaves to a formula that depends on something that has not happened (delivery of the space, completion of work); leave it empty and say so in the summary.\n- **A date that follows from two fixed figures may be worked out.** When the lease fixes the commencement date and states the term (for example 38 months) but prints no expiration date, the Expiration Date is the last day of the final month of the term. Do the same for a renewal or termination notice deadline that is a stated number of days or months before a fixed date. Use medium confidence, put the working in the quote ("38 months from 2025-04-01"), and list every date you worked out in the summary. A signed commencement date memorandum, when it is filled in, replaces any date worked out this way.'),
    updated_at = now()
where org_id is null and key = 'reading-a-lease'
  and position('may be worked out' in instructions) = 0;

alter table skills force row level security;

commit;
