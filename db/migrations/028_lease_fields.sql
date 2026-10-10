-- Lease fields: the terms of a lease agreement, read from the lease itself.
-- Run after 027_which_source_wins.sql. Safe to run more than once.
--
-- 1. A lease becomes a record that can carry fields, like a property: the
--    places that list the kinds of record now accept 'lease'.
-- 2. A lease document can be tied to its lease (documents.lease_id).
-- 3. A standard Lease screen with eight sections and 55 standard fields.
--    Organizations add their own in the Fields Library, like any other field.
-- 4. A standard skill, Reading a Lease, and a part on leases and amendments
--    added to the Which Source Wins skill.

begin;

alter table field_definitions no force row level security;
alter table screens no force row level security;
alter table sections no force row level security;
alter table section_fields no force row level security;
alter table skills no force row level security;

-- ---------------------------------------------------------------------------
-- 1. Lease as a kind of record
-- ---------------------------------------------------------------------------

do $$
declare
  t record;
  c record;
begin
  for t in
    select * from (values
      ('field_definitions', 'applies_to'), ('sections', 'applies_to'), ('field_lists', 'applies_to'),
      ('field_values', 'record_type'), ('field_list_rows', 'record_type'), ('document_findings', 'record_type'), ('field_proposals', 'record_type')
    ) as v (tbl, col)
  loop
    for c in
      select conname from pg_constraint
      where conrelid = (current_schema() || '.' || t.tbl)::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%' || t.col || '%' and pg_get_constraintdef(oid) like '%''asset''%'
    loop
      execute format('alter table %I drop constraint %I', t.tbl, c.conname);
    end loop;
    execute format(
      'alter table %I add constraint %I check (%I in (''asset'', ''property'', ''building'', ''floor'', ''unit'', ''lease''))',
      t.tbl, t.tbl || '_' || t.col || '_check', t.col
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A document can belong to a lease
-- ---------------------------------------------------------------------------

alter table documents add column if not exists lease_id uuid references leases (id) on delete set null;
create index if not exists documents_lease_idx on documents (org_id, lease_id) where lease_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Screen, sections and fields
-- ---------------------------------------------------------------------------

insert into screens (key, name, sort_order)
select 'lease', 'Lease', 40
where not exists (select 1 from screens s where s.org_id is null and s.key = 'lease');

insert into sections (screen_id, key, name, applies_to, display_style, sort_order)
select s.id, v.key, v.name, 'lease', 'form', v.sort_order
from screens s
cross join (values
  ('leaseParties', E'Parties and Premises', 10),
  ('leaseTerm', E'Term', 20),
  ('leaseRent', E'Rent', 30),
  ('leaseRecoveries', E'Expense Recoveries', 40),
  ('leaseOptions', E'Options and Rights', 50),
  ('leaseUse', E'Use and Restrictions', 60),
  ('leaseSecurity', E'Security and Credit', 70),
  ('leaseOther', E'Other Terms', 80)
) as v (key, name, sort_order)
where s.org_id is null and s.key = 'lease'
on conflict ((coalesce(org_id, '')), applies_to, key) do nothing;

insert into field_definitions
  (key, name, applies_to, data_type, unit, group_name, sort_order, ai_description, source_priority, agent_instructions, options)
select v.key, v.name, 'lease', v.data_type, v.unit, v.group_name, v.sort_order, v.description, '{documents,manual}', v.instructions, v.options
from (values
  ('leaseType', E'Lease Type', 'picklist', NULL, E'Parties and Premises', 10, E'How operating costs are shared between landlord and tenant.', E'**Also called:** Lease Structure, Rent Basis.\n\nChoose the closest option from how the lease divides operating expenses, taxes and insurance, not from the document''s title. Triple Net: the tenant pays its share of all three. Full Service Gross: the rent includes them. Modified Gross and Base Year: the tenant pays increases over a base year or stop. Absolute Net: the tenant also pays for structure and roof. Ground Lease: land only.', E'[{"key":"tripleNet","label":"Triple Net"},{"key":"absoluteNet","label":"Absolute Net"},{"key":"modifiedGross","label":"Modified Gross"},{"key":"baseYear","label":"Base Year"},{"key":"fullServiceGross","label":"Full Service Gross"},{"key":"gross","label":"Gross"},{"key":"groundLease","label":"Ground Lease"},{"key":"other","label":"Other"}]'::jsonb),
  ('landlordEntity', E'Landlord', 'text', NULL, E'Parties and Premises', 20, E'The legal name of the landlord as the lease states it.', E'**Also called:** Lessor, Owner.\n\nThe full legal name with its entity type and state, as written in the opening paragraph. If an amendment names a successor landlord, give the latest.', NULL::jsonb),
  ('tenantLegalName', E'Tenant Legal Name', 'text', NULL, E'Parties and Premises', 30, E'The legal name of the tenant as the lease states it.', E'**Also called:** Lessee.\n\nThe full legal name with its entity type and state, as written in the opening paragraph. If the lease was assigned, give the current tenant and mention the assignment in Amendments.', NULL::jsonb),
  ('tenantTradeName', E'Trade Name', 'text', NULL, E'Parties and Premises', 40, E'The name the tenant does business under at the premises, when it differs from its legal name.', E'**Also called:** DBA, Doing Business As.\n\nLeave empty when the lease gives none.', NULL::jsonb),
  ('premises', E'Premises', 'text', NULL, E'Parties and Premises', 50, E'The space leased: suite or unit number, floor and building.', E'**Also called:** Demised Premises, Leased Premises.\n\nOne line, for example "Suite 450, 4th floor, 15601 Dallas Parkway". Include storage or patio space when the lease grants it.', NULL::jsonb),
  ('leaseRentableSquareFeet', E'Rentable Square Feet per Lease', 'number', E'SF', E'Parties and Premises', 60, E'The rentable area of the premises as the lease states it.', E'**Also called:** Rentable Area, RSF, Premises Area.\n\nThe figure in the lease, after any amendment that expands or shrinks the space. Rentable, not usable, when both are given.', NULL::jsonb),
  ('proRataShare', E'Pro Rata Share', 'percent', NULL, E'Parties and Premises', 70, E'The tenant''s share of the building''s operating expenses, as a percentage.', E'**Also called:** Tenant''s Proportionate Share, Tenant''s Share.\n\nAs stated. If the lease gives different shares for taxes and for operating expenses, give the operating expense share and mention the other in Expense Recovery Terms.', NULL::jsonb),
  ('leaseDate', E'Lease Date', 'date', NULL, E'Parties and Premises', 80, E'The date of the original lease agreement.', E'**Also called:** Effective Date, Date of Lease, Execution Date.\n\nThe date in the opening paragraph of the original lease, not of an amendment.', NULL::jsonb),
  ('leaseAmendments', E'Amendments', 'text', NULL, E'Parties and Premises', 90, E'Each amendment, assignment or commencement letter, with its date and what it changed.', E'One line per document, oldest first: its name, date and a few words on what it changed, for example "First Amendment, 2023-06-01: extended the term five years and added Suite 460". Write "None" only when the documents say there are none.', NULL::jsonb),
  ('commencementDate', E'Commencement Date', 'date', NULL, E'Term', 10, E'The date the lease term begins.', E'**Also called:** Lease Commencement, Term Commencement.\n\nPrefer a signed commencement date letter or memorandum over the estimated date in the lease. If the lease gives only a formula (for example, 120 days after delivery) and no document fixes the date, leave it empty and say so in the summary.', NULL::jsonb),
  ('rentCommencementDate', E'Rent Commencement Date', 'date', NULL, E'Term', 20, E'The date the tenant starts paying base rent.', E'**Also called:** Rent Start Date.\n\nOften later than the Commencement Date because of free rent or a build-out period. Leave empty when it is the same as the Commencement Date and the lease does not state it separately.', NULL::jsonb),
  ('expirationDate', E'Expiration Date', 'date', NULL, E'Term', 30, E'The date the current term ends, before any unexercised renewal option.', E'**Also called:** Lease Expiration, Termination Date, LXD.\n\nThe latest expiration after all amendments and exercised extensions. Never include a renewal option that has not been exercised.', NULL::jsonb),
  ('leaseTermMonths', E'Lease Term', 'number', E'months', E'Term', 40, E'The length of the current term in months.', E'**Also called:** Initial Term, Term.\n\nAs stated; convert years to months. For an extended lease, the months from the original commencement to the current expiration.', NULL::jsonb),
  ('holdoverTerms', E'Holdover Terms', 'text', NULL, E'Term', 50, E'What the tenant owes if it stays past the expiration without a new agreement.', E'**Also called:** Holding Over.\n\nThe rent multiple and the kind of tenancy, for example "150% of the last monthly base rent; month-to-month".', NULL::jsonb),
  ('baseRentSchedule', E'Base Rent Schedule', 'text', NULL, E'Rent', 10, E'The base rent for each period of the term.', E'**Also called:** Minimum Rent, Fixed Rent, Rent Schedule.\n\nOne line per period: the dates or lease months, then the monthly rent, the annual rent and the rent per square foot, whichever the lease gives. Copy the figures exactly; do not work out a period the lease does not state. Use the schedule from the latest amendment that changes rent.', NULL::jsonb),
  ('initialAnnualBaseRent', E'Initial Annual Base Rent', 'money', E'USD', E'Rent', 20, E'The yearly base rent in the first year rent is paid.', E'The first full year''s base rent from the rent schedule, before free rent. Twelve times the monthly rent when only that is stated.', NULL::jsonb),
  ('rentEscalations', E'Rent Escalations', 'text', NULL, E'Rent', 30, E'How base rent increases over the term.', E'**Also called:** Rent Bumps, Annual Increases.\n\nThe rule in a few words, for example "3% each year on the anniversary of the Commencement Date" or "CPI, minimum 2%, maximum 5%". When rent simply follows a fixed schedule, write "Fixed steps; see Base Rent Schedule".', NULL::jsonb),
  ('freeRentMonths', E'Free Rent', 'number', E'months', E'Rent', 40, E'The number of months of abated base rent.', E'**Also called:** Rent Abatement, Rent Concession.\n\nThe total months of abated base rent. Count a half-rent month as half a month. Zero only when the lease says there is none.', NULL::jsonb),
  ('freeRentTerms', E'Free Rent Terms', 'text', NULL, E'Rent', 50, E'Which months are abated and any conditions on the abatement.', E'Which months, whether operating expenses are still paid, and whether the abatement must be repaid on a default.', NULL::jsonb),
  ('percentageRent', E'Percentage Rent', 'text', NULL, E'Rent', 60, E'Rent paid as a share of the tenant''s sales, with its breakpoint.', E'**Also called:** Overage Rent.\n\nRetail leases. The percentage, the breakpoint (natural or stated amount) and how often sales are reported. Leave empty when the lease has none.', NULL::jsonb),
  ('lateCharges', E'Late Charges', 'text', NULL, E'Rent', 70, E'The fee and interest when rent is paid late.', E'The grace period, the late fee and the interest rate, in one line.', NULL::jsonb),
  ('expenseRecoveryTerms', E'Expense Recovery Terms', 'text', NULL, E'Expense Recoveries', 10, E'What operating expenses, taxes and insurance the tenant pays, and how.', E'**Also called:** Additional Rent, CAM, Operating Expense Pass-Throughs.\n\nA short plain summary: which costs the tenant pays (operating expenses, real estate taxes, insurance), whether as its full share or only increases over a base, and whether costs are grossed up to a stated occupancy.', NULL::jsonb),
  ('baseYear', E'Base Year', 'text', NULL, E'Expense Recoveries', 20, E'The year whose expenses set the base the tenant pays increases over.', E'As stated, for example "2025" or "Calendar year 2025 for operating expenses; tax year 2025/2026 for taxes". Leave empty for a net lease.', NULL::jsonb),
  ('expenseStop', E'Expense Stop', 'money', E'USD per SF', E'Expense Recoveries', 30, E'The amount of expenses per square foot the landlord pays before the tenant pays the rest.', E'Leave empty unless the lease states a dollar stop.', NULL::jsonb),
  ('expenseCaps', E'Caps on Expense Increases', 'text', NULL, E'Expense Recoveries', 40, E'Any limit on how much recoverable expenses may rise each year.', E'**Also called:** CAM Cap, Controllable Expense Cap.\n\nThe percentage, whether it is cumulative or compounding, and which costs are outside the cap (usually taxes, insurance, utilities, snow removal).', NULL::jsonb),
  ('managementFeeTerms', E'Management and Administrative Fees', 'text', NULL, E'Expense Recoveries', 50, E'Any management or administrative fee the landlord may add to recoverable expenses.', E'The percentage and what it is charged on. Leave empty when the lease is silent.', NULL::jsonb),
  ('utilitiesResponsibility', E'Utilities', 'text', NULL, E'Expense Recoveries', 60, E'Who pays for electricity and other utilities, and how they are measured.', E'For example "Tenant pays electricity by submeter; water and gas included in operating expenses".', NULL::jsonb),
  ('auditRights', E'Audit Rights', 'text', NULL, E'Expense Recoveries', 70, E'The tenant''s right to review the landlord''s expense records.', E'The deadline to object to a statement, who may audit, and who pays for it.', NULL::jsonb),
  ('renewalOptions', E'Renewal Options', 'text', NULL, E'Options and Rights', 10, E'The tenant''s options to extend the term.', E'**Also called:** Extension Options, Options to Renew.\n\nThe number of options, the length of each, how the rent is set (fair market value, a fixed amount, a percentage increase) and the notice required, for example "Two 5-year options at 95% of fair market rent; notice 9 to 12 months before expiration". Say which have already been exercised.', NULL::jsonb),
  ('renewalNoticeDeadline', E'Renewal Notice Deadline', 'date', NULL, E'Options and Rights', 20, E'The last date the tenant may give notice to exercise its next renewal option.', E'Work the date out only when the lease gives a notice period and the Expiration Date is fixed: the Expiration Date less the minimum notice period. Add it as a critical date too. Leave empty when there is no unexercised option.', NULL::jsonb),
  ('terminationRights', E'Termination Rights', 'text', NULL, E'Options and Rights', 30, E'Any right of the tenant or landlord to end the lease early.', E'**Also called:** Early Termination, Kick-Out, Cancellation Option.\n\nWho holds it, the earliest effective date, the notice required and any fee. Include a landlord''s right to terminate for redevelopment or relocation. Casualty and condemnation terminations are standard; leave them out.', NULL::jsonb),
  ('expansionRights', E'Expansion Rights', 'text', NULL, E'Options and Rights', 40, E'The tenant''s rights to take more space: expansion options, rights of first offer and of first refusal.', E'**Also called:** ROFO, ROFR, Right of First Offer, Right of First Refusal, Must-Take Space.\n\nName each right, the space it covers and how long the tenant has to respond.', NULL::jsonb),
  ('contractionRights', E'Contraction Rights', 'text', NULL, E'Options and Rights', 50, E'The tenant''s right to give back part of the premises.', E'The space, the earliest date, the notice and any fee. Leave empty when there is none.', NULL::jsonb),
  ('purchaseOption', E'Purchase Option', 'text', NULL, E'Options and Rights', 60, E'Any right of the tenant to buy the property or to match an offer for it.', E'The price or how it is set, and when it can be exercised. Leave empty when there is none.', NULL::jsonb),
  ('relocationRight', E'Landlord Relocation Right', 'text', NULL, E'Options and Rights', 70, E'The landlord''s right to move the tenant to other space.', E'The notice required, who pays the moving costs and whether the new space must be comparable.', NULL::jsonb),
  ('permittedUse', E'Permitted Use', 'text', NULL, E'Use and Restrictions', 10, E'What the tenant may use the premises for.', E'**Also called:** Use Clause.\n\nAs the lease states it, shortened to a line.', NULL::jsonb),
  ('exclusiveUse', E'Exclusive Use', 'text', NULL, E'Use and Restrictions', 20, E'Any promise that the landlord will not lease to the tenant''s competitors.', E'**Also called:** Exclusive, Exclusivity.\n\nWhat is protected, over what area, the exceptions and the tenant''s remedy if it is breached.', NULL::jsonb),
  ('coTenancy', E'Co-Tenancy', 'text', NULL, E'Use and Restrictions', 30, E'Any right of the tenant that depends on other tenants being open or on overall occupancy.', E'Retail leases. The named anchors or the occupancy level required, and the remedy (reduced rent, termination) with its timing.', NULL::jsonb),
  ('radiusRestriction', E'Radius Restriction', 'text', NULL, E'Use and Restrictions', 40, E'Any limit on the tenant opening another location nearby.', E'The distance and what it applies to.', NULL::jsonb),
  ('operatingCovenant', E'Operating Covenant', 'text', NULL, E'Use and Restrictions', 50, E'Whether the tenant must stay open and operating, and its hours.', E'**Also called:** Continuous Operation, Go-Dark Right.\n\nSay whether the tenant must operate continuously, the minimum hours, and whether it may go dark while paying rent.', NULL::jsonb),
  ('assignmentAndSubletting', E'Assignment and Subletting', 'text', NULL, E'Use and Restrictions', 60, E'The tenant''s right to assign the lease or sublet the space.', E'Whether the landlord''s consent is needed and on what standard, which transfers need no consent (affiliates, mergers), whether the landlord may recapture the space and how sublease profits are shared.', NULL::jsonb),
  ('signageRights', E'Signage Rights', 'text', NULL, E'Use and Restrictions', 70, E'The tenant''s rights to building, monument or pylon signage.', E'Which signs, whether exclusive, and who pays.', NULL::jsonb),
  ('parkingRights', E'Parking Rights', 'text', NULL, E'Use and Restrictions', 80, E'The tenant''s parking: number of spaces, reserved or not, and any charge.', E'For example "4 per 1,000 SF unreserved at no charge; 6 reserved garage spaces at $95 a month each".', NULL::jsonb),
  ('securityDeposit', E'Security Deposit', 'money', E'USD', E'Security and Credit', 10, E'The cash security deposit the landlord holds.', E'The amount now held, after any reduction an amendment or the lease''s burn-down schedule provides. Zero only when the lease says there is none. A letter of credit goes in Letter of Credit instead.', NULL::jsonb),
  ('letterOfCredit', E'Letter of Credit', 'text', NULL, E'Security and Credit', 20, E'Any letter of credit given as security, with its amount and reductions.', E'The amount, the issuer if named, and any schedule by which it steps down.', NULL::jsonb),
  ('guarantor', E'Guarantor', 'text', NULL, E'Security and Credit', 30, E'Who guarantees the tenant''s obligations.', E'The guarantor''s full name. Leave empty when there is no guaranty.', NULL::jsonb),
  ('guarantyTerms', E'Guaranty Terms', 'text', NULL, E'Security and Credit', 40, E'How far the guaranty goes: full, capped or limited in time.', E'For example "Full guaranty of all obligations" or "Limited to 12 months of rent, falling away after year 5 if no default".', NULL::jsonb),
  ('tenantImprovementAllowance', E'Tenant Improvement Allowance', 'money', E'USD', E'Other Terms', 10, E'The amount the landlord contributes to building out the premises.', E'**Also called:** TI Allowance, Construction Allowance, Improvement Allowance.\n\nThe total dollar amount. When the lease gives it only per square foot, multiply by the rentable square feet in the lease and say so in the summary.', NULL::jsonb),
  ('landlordWork', E'Landlord''s Work', 'text', NULL, E'Other Terms', 20, E'What the landlord must build or deliver before the tenant takes the space.', E'A line or two; "As is" when the tenant takes the space in its present condition.', NULL::jsonb),
  ('maintenanceResponsibilities', E'Maintenance and Repairs', 'text', NULL, E'Other Terms', 30, E'Who maintains and repairs what.', E'What the landlord maintains (usually structure, roof, common areas, building systems) and what the tenant maintains. Call out an HVAC unit the tenant must maintain or replace.', NULL::jsonb),
  ('insuranceRequirements', E'Tenant Insurance Requirements', 'text', NULL, E'Other Terms', 40, E'The insurance the tenant must carry.', E'The main coverages and limits in one line, for example "Commercial general liability $1M per occurrence / $2M aggregate; property insurance on tenant improvements".', NULL::jsonb),
  ('subordinationAndEstoppel', E'Subordination and Estoppel', 'text', NULL, E'Other Terms', 50, E'The tenant''s duties to subordinate to the lender and to sign estoppel certificates.', E'**Also called:** SNDA.\n\nWhether the lease is subordinate automatically or only with a non-disturbance agreement, and how many days the tenant has to return an estoppel.', NULL::jsonb),
  ('surrenderAndRestoration', E'Surrender and Restoration', 'text', NULL, E'Other Terms', 60, E'The condition the tenant must leave the premises in.', E'Whether the tenant must remove its improvements, cabling or signs at the end of the term.', NULL::jsonb),
  ('tenantNoticeAddress', E'Tenant Notice Address', 'text', NULL, E'Other Terms', 70, E'Where notices to the tenant must be sent.', E'The address for notices as the lease or its latest amendment gives it, with any required copy.', NULL::jsonb),
  ('leaseSummary', E'Lease Summary', 'text', NULL, E'Other Terms', 80, E'A short plain-words summary of the lease.', E'100 words or fewer: who leases what, for how long, at what rent, and the two or three terms an owner most needs to know (an early termination right, an expiring option, an unusual restriction). Facts only.', NULL::jsonb)
) as v (key, name, data_type, unit, group_name, sort_order, description, instructions, options)
on conflict ((coalesce(org_id, '')), applies_to, key) do nothing;

insert into section_fields (section_id, field_id, position)
select s.id, f.id, f.sort_order
from field_definitions f
join sections s on s.org_id is null and s.applies_to = 'lease' and s.key = case f.group_name when E'Parties and Premises' then 'leaseParties' when E'Term' then 'leaseTerm' when E'Rent' then 'leaseRent' when E'Expense Recoveries' then 'leaseRecoveries' when E'Options and Rights' then 'leaseOptions' when E'Use and Restrictions' then 'leaseUse' when E'Security and Credit' then 'leaseSecurity' when E'Other Terms' then 'leaseOther' end
where f.org_id is null and f.list_id is null and f.applies_to = 'lease'
on conflict ((coalesce(org_id, '')), section_id, field_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Skills
-- ---------------------------------------------------------------------------

insert into skills (key, name, use_when, instructions, created_by, updated_by)
select 'reading-a-lease', 'Reading a Lease',
  'The document is a lease agreement, a lease amendment, a commencement date letter, an assignment, a guaranty or a lease abstract for one tenant.',
  E'### What This Document Is\nA lease between a landlord and one tenant for particular space, often with amendments, a commencement letter, an assignment or a guaranty attached or loaded separately. It was loaded onto one lease in Stratios; every value belongs to that lease.\n\n### Reading Order\n- Start with the summary of basic lease terms if the lease has one (often the first pages), then check each term against the body of the lease, which wins when they differ.\n- Then read every amendment in date order. **A later amendment replaces the term it changes.** Give each field its value as it stands after the latest document, and list every amendment in Amendments.\n- An exhibit can change the deal: look for the rent schedule, the work letter (allowance), the commencement date memorandum, the rules on signage and parking, and any guaranty.\n\n### Rules\n- Copy dates and dollar figures exactly as written. Never estimate a date the lease leaves to a formula; leave it empty and say so in the summary.\n- A blank in an unsigned or draft lease is not a value. If the document is unsigned or marked draft, say so in the summary and use low confidence.\n- Keep each text answer short and factual: the terms, not the legal wording. Give section numbers only when they help find a term.\n- A term the lease does not have (no percentage rent, no guaranty) is left empty, not written as "None", unless the field''s own instructions say otherwise.\n- Do not return a rent roll, an address or photographs from a lease.\n\n### Critical Dates\nAdd a critical date to the property for each of these the lease fixes, naming the tenant and the unit in the description:\n- The expiration date.\n- The last day to give notice for each unexercised renewal option, and for each termination, expansion or contraction right.\n- Each date the rent steps up, for the next 24 months only.\n- The date a letter of credit or security deposit steps down.\n\n### What to Mention in the Summary\n- Which documents were read (the lease and each amendment, with dates).\n- Anything unusual an owner should know: an early termination right, a co-tenancy remedy, an exclusive, a purchase option, a cap on expense recoveries.\n- Any term that could not be pinned down, and why.',
  'stratios', 'stratios'
where not exists (select 1 from skills s where s.org_id is null and s.key = 'reading-a-lease');

update skills
set instructions = instructions || E'\n\n' || E'### Leases and Amendments\nA signed lease, with its amendments, is the source for the terms of that lease.\n- A later amendment **replaces** what the lease or an earlier amendment said. An earlier document never replaces a later one: keep.\n- A commencement date letter **replaces** an estimated commencement, rent commencement or expiration date from the lease.\n- A lease abstract or summary prepared by someone else does not replace a value taken from the signed lease itself: ask.\n- A draft or unsigned lease never replaces anything: ask.\n- A rent roll says what is being billed today; it does not change the lease''s own fields. Where the two disagree, both are kept and shown side by side.', updated_at = now()
where org_id is null and key = 'which-source-wins' and position('### Leases and Amendments' in instructions) = 0;

alter table field_definitions force row level security;
alter table screens force row level security;
alter table sections force row level security;
alter table section_fields force row level security;
alter table skills force row level security;

commit;
