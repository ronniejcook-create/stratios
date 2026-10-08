-- Stratios data design, stage 3 (part 2): roles and field permissions.
-- Run after 004_sections_and_lists.sql. Safe to run more than once.
--
-- Administrators (set in the sign-in system) always see and edit everything.
-- Everyone else gets access through roles:
--   - every organization has one built-in role, Member, that applies to all
--     of its people;
--   - administrators can create more roles and assign people to them.
-- A role has a default access level and can be given a different level for a
-- section, or for a single field. A person with several roles gets the most
-- generous access among them.

create table if not exists roles (
  id             uuid primary key default gen_random_uuid(),
  org_id         text not null,
  key            text not null check (key ~ '^[a-z][A-Za-z0-9]*$'),
  name           text not null check (length(trim(name)) > 0),
  default_level  text not null default 'view' check (default_level in ('hidden', 'view', 'edit')),
  is_member      boolean not null default false,   -- the built-in role everyone holds
  created_by     text not null,
  created_at     timestamptz not null default now()
);
create unique index if not exists roles_org_key_idx on roles (org_id, key);
-- At most one built-in Member role per organization.
create unique index if not exists roles_member_idx on roles (org_id) where is_member;

create table if not exists member_roles (
  org_id       text not null,
  user_id      text not null,
  role_id      uuid not null references roles (id) on delete cascade,
  assigned_by  text not null,
  assigned_at  timestamptz not null default now(),
  primary key (org_id, user_id, role_id)
);

-- A rule gives one role a level for one section, or for one field. A field
-- rule wins over its section's rule, which wins over the role's default.
create table if not exists field_permissions (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  role_id     uuid not null references roles (id) on delete cascade,
  section_id  uuid references sections (id) on delete cascade,
  field_id    uuid references field_definitions (id) on delete cascade,
  level       text not null check (level in ('hidden', 'view', 'edit')),
  check (num_nonnulls(section_id, field_id) = 1)
);
create unique index if not exists field_permissions_rule_idx on field_permissions (
  role_id,
  (coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid)),
  (coalesce(field_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

do $$
declare
  t text;
begin
  foreach t in array array['roles', 'member_roles', 'field_permissions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_org_isolation', t);
    execute format(
      'create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))',
      t || '_org_isolation', t
    );
  end loop;
end $$;
