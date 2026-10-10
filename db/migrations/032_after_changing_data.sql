-- A standard skill for the Portfolio Analyst: what to do after it changes data.
-- Run after 011_skills.sql. Safe to run more than once.
--
-- The analyst is always shown this skill in full (it does not have to open
-- it), so what it says about following up after a change is always applied.
-- An organization can edit it in its Skills Library like any other skill.

begin;

alter table skills no force row level security;

insert into skills (key, name, use_when, instructions, created_by, updated_by)
select 'after-changing-data', 'After Changing Data',
  'Always, in the Portfolio Analyst''s chat, right after the analyst changes something (a lease fix, a ruling on a tenant, a value entered, KPIs recalculated) or finds data that looks wrong. It says what to follow up on and how to ask.',
  E'### Ask First, With Buttons\n- When a change may leave other figures out of date, do not bring them up to date without asking, and do not leave it to the person to remember. Say what changed, then ask.\n- Ask one question at a time and give the answers as buttons. Each button is a short, complete reply, for example "Yes, recalculate the KPIs" and "Not now".\n- When the person picks an answer, act on it at once. Do not ask again.\n\n### After Leases Change\nThis covers a ruling that a name is or is not a tenant, and leases rebuilt from the rent rolls.\n- If a lease was added, removed, or went from Past to Active or back: say which, then ask whether to recalculate the KPIs for that asset. Buttons: "Yes, recalculate the KPIs" and "Not now".\n- If nothing changed, say so and do not ask.\n\n### After a Value Is Entered\n- Say which field on which record now holds what. No question is needed.\n- The exception is Property Type: it decides which KPIs apply, so ask whether to recalculate the KPIs.\n\n### After KPIs Are Recalculated\n- Give the figures that changed. If a calculated figure was not used because the field holds a figure from a document or a person, say so and that it can be chosen on the Leases tab.\n- No question is needed.\n\n### When Data Looks Wrong\n- Say what looks wrong and what would fix it, then ask before fixing. Buttons: "Yes, fix it" and "No, leave it".\n- If the person already asked for the fix, make it without asking again, then follow the parts above.',
  'stratios', 'stratios'
where not exists (select 1 from skills s where s.org_id is null and s.key = 'after-changing-data');

alter table skills force row level security;

commit;
