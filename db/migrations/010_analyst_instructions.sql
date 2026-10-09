-- The Portfolio Analyst's general instructions, editable by Stratios
-- administrators on the Stratios Admin > Analyst Instructions screen.
-- Run after 009_agent_documents.sql. Safe to run more than once.
--
-- One row per agent (today only 'analyst'). The instructions apply to every
-- organization, so the table has no organization column: everyone's analyst
-- reads it, and only Stratios administrators can change it (the app marks
-- those requests with app.stratios_admin, as it does for the master library).
-- With no row, the analyst uses the instructions built into the app.

create table if not exists agent_profiles (
  agent         text primary key,
  instructions  text not null,
  updated_by    text not null,
  updated_at    timestamptz not null default now()
);

alter table agent_profiles enable row level security;
alter table agent_profiles force row level security;

drop policy if exists agent_profiles_read on agent_profiles;
create policy agent_profiles_read on agent_profiles for select using (true);

drop policy if exists agent_profiles_stratios_admin on agent_profiles;
create policy agent_profiles_stratios_admin on agent_profiles for all
  using (current_setting('app.stratios_admin', true) = 'on')
  with check (current_setting('app.stratios_admin', true) = 'on');
