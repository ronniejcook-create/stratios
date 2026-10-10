-- The rules for tenants and leases move into the Reading a Rent Roll skill.
-- Run after 024_tenants_and_leases.sql. Safe to run more than once.
--
-- The agent now decides, while it reads a rent roll and following the skill:
-- which rows are tenants, which names look like a tenant already on file (and
-- whether to ask a person or match by itself), and what makes a row the same
-- lease as one on file. Its decisions are saved here, on the rent roll and
-- its rows, and applied from there; the agent is not asked again later.
--
-- A rent roll with no saved decisions (loaded before this, or read when no
-- skill covers rent rolls) keeps using the built-in rules.

alter table rent_rolls add column if not exists tenants_decided boolean not null default false;
-- tenant_unit_start: a new lease start is a new lease. tenant_unit: a renewal carries on the same lease.
alter table rent_rolls add column if not exists lease_match text check (lease_match in ('tenant_unit_start', 'tenant_unit'));

-- tenant: counts as a tenant whatever its rent. not_tenant: space the owner uses. Empty: no decision.
alter table rent_roll_rows add column if not exists tenant_call text check (tenant_call in ('tenant', 'not_tenant'));
-- The tenant on file this name looks like, as the agent wrote it, and whether it may be matched without asking.
alter table rent_roll_rows add column if not exists tenant_like text;
alter table rent_roll_rows add column if not exists tenant_like_sure boolean not null default false;

begin;

alter table skills no force row level security;

update skills
set instructions = instructions || E'\n\n### Tenants\n- A leased row names a tenant.\n- Space the owner uses is not a tenant: a leased row that shows no rent at all, in a rent roll where most tenants do show rent (a management office, an amenity lounge, a janitor''s closet, a vending area). Mark each such name **not a tenant**.\n- Compare every tenant name with the tenants already on file.\n  - Spelled the same, apart from capitals and punctuation: it is that tenant. Say nothing.\n  - It looks like the same business under a slightly different name (a different legal ending such as Inc, LLC or Corp; a shorter or longer form of the name; a small spelling difference): mark it **same as** the tenant on file, and **ask**. A person will confirm before anything is matched.\n  - Two different businesses that happen to share a word (First National Bank and First Dental) are different tenants. Say nothing.\n  - A name with no look-alike on file is a new tenant. Say nothing.\n- Never match a look-alike without asking.',
    updated_at = now()
where org_id is null and key = 'reading-a-rent-roll'
  and position('### Tenants' in instructions) = 0;

update skills
set instructions = instructions || E'\n\n### Leases\n- A row carries on a lease already on file when the tenant, the unit and the lease start date are all the same. A different start date is a new lease, even for the same tenant in the same unit.\n- So the lease match is: **tenant, unit and start date**.',
    updated_at = now()
where org_id is null and key = 'reading-a-rent-roll'
  and position('### Leases' in instructions) = 0;

alter table skills force row level security;

commit;
