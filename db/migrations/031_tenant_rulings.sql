-- A person's word on whether a name in a rent roll is a tenant.
-- Run after 025_tenant_rules_in_skill.sql. Safe to run more than once.
--
-- While reading a rent roll the agent decides which leased rows are tenants.
-- Two readings can disagree (a tenant shown with no rent was a tenant in one
-- rent roll and "space the owner uses" in the next), which turned a current
-- lease into a past one. A ruling made by a person settles a name for every
-- rent roll, loaded before or after: it comes before the agent's call.

create table if not exists tenant_rulings (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null,
  -- The name as the person gave it, and in the plain form names are compared in.
  written_name  text not null,
  name_key      text not null,
  is_tenant     boolean not null,
  decided_by    text not null,
  decided_at    timestamptz not null default now()
);
create unique index if not exists tenant_rulings_name_idx on tenant_rulings (org_id, name_key);

alter table tenant_rulings enable row level security;
alter table tenant_rulings force row level security;
drop policy if exists tenant_rulings_org_isolation on tenant_rulings;
create policy tenant_rulings_org_isolation on tenant_rulings
  using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));

begin;

alter table skills no force row level security;

-- The standard skill: a name already on file as a tenant stays a tenant.
update skills
set instructions = instructions || E'\n\n### Tenants Already on File\n- A name that is already on file as a tenant is a tenant, even when its row shows no rent (free rent, a rent holiday, or a tenant that pays only electricity or other recoveries). Do not mark it not a tenant.\n- "Not a tenant" is for space the owner uses, named for what it is (management office, amenity lounge, janitor, vending), not for a business or organization with a lease.',
    updated_at = now()
where org_id is null and key = 'reading-a-rent-roll'
  and position('### Tenants Already on File' in instructions) = 0;

alter table skills force row level security;

commit;
