-- Skills by organization. Run after 011_skills.sql. Safe to run more than once.
--
-- Stratios standard skills (org_id null) are still shared by everyone. An
-- organization can now also keep its own skills (org_id = the organization).
-- An organization's skill with the same key as a standard one replaces that
-- standard skill for that organization only; that is how an organization
-- changes or turns off a standard skill without affecting anyone else.

drop policy if exists skills_own_insert on skills;
create policy skills_own_insert on skills for insert
  with check (org_id = current_setting('app.org_id', true));

drop policy if exists skills_own_update on skills;
create policy skills_own_update on skills for update
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));

drop policy if exists skills_own_delete on skills;
create policy skills_own_delete on skills for delete
  using (org_id = current_setting('app.org_id', true));

-- Lets the Stratios library show how many organizations have their own
-- version of a standard skill, and keeps a new standard skill's key clear of
-- every organization's. Read-only: an organization's skills stay its own.
drop policy if exists skills_stratios_admin_read on skills;
create policy skills_stratios_admin_read on skills for select
  using (current_setting('app.stratios_admin', true) = 'on');
