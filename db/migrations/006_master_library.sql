-- Stratios data design, stage 3 (part 3): the master library.
-- Run after 005_roles_and_permissions.sql. Safe to run more than once.
--
-- Stratios standard fields, screens, sections and lists have no organization
-- (org_id null), and the row-level security rules so far let an organization
-- change only its own rows. Stratios staff manage the standard rows from the
-- Master Library screen. The app marks those requests by setting
--   select set_config('app.stratios_admin', 'on', true)
-- for the transaction, and only does so after checking that the signed-in
-- person is an administrator of the Stratios organization.

do $$
declare
  t text;
begin
  foreach t in array array['field_definitions', 'screens', 'sections', 'section_fields', 'field_lists'] loop
    execute format('drop policy if exists %I on %I', t || '_stratios_admin', t);
    execute format(
      'create policy %I on %I for all using (current_setting(''app.stratios_admin'', true) = ''on'') with check (current_setting(''app.stratios_admin'', true) = ''on'')',
      t || '_stratios_admin', t
    );
  end loop;
end $$;

-- Lets the Master Library show how many organizations have customized a
-- standard field. Read-only: an organization's changes stay its own.
drop policy if exists field_settings_stratios_admin_read on field_settings;
create policy field_settings_stratios_admin_read on field_settings for select
  using (current_setting('app.stratios_admin', true) = 'on');

-- Mark the Stratios organization by recording stratios.app as its company
-- domain (see lib/stratios.ts). It was created by hand in the sign-in system,
-- so the usual sign-up step that records the domain never ran for it.
-- An earlier version of this file named the wrong organization; the first
-- statement takes the marker back off it.
update organization_settings
set domain = null, updated_at = now()
where org_id = 'org_3KORIXREU8taMpsPwTA1obv5xRL' and domain = 'stratios.app';

insert into organization_settings (org_id, domain)
select 'org_3KQzLNz4UcqIKfuNdLBcuVz3JWj', 'stratios.app'
where not exists (
  select 1 from organization_settings where domain = 'stratios.app' and org_id <> 'org_3KQzLNz4UcqIKfuNdLBcuVz3JWj'
)
on conflict (org_id) do update set domain = excluded.domain, updated_at = now();
