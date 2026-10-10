-- Saved conversations with the Portfolio Analyst.
-- Run after 009_agent_documents.sql. Safe to run more than once.
--
-- Until now a conversation lived in the browser and was lost on reload. Each
-- person's conversations are now kept: one row per conversation and one per
-- message. A conversation belongs to the person who had it; nobody else in
-- the organization sees it (the app only ever reads a person's own).

create table if not exists agent_conversations (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  user_id     text not null,
  -- The start of the first message, shown in the list of chats.
  title       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists agent_conversations_owner_idx on agent_conversations (org_id, user_id, updated_at desc);

create table if not exists agent_messages (
  id               uuid primary key default gen_random_uuid(),
  org_id           text not null,
  conversation_id  uuid not null references agent_conversations (id) on delete cascade,
  position         integer not null,
  role             text not null check (role in ('user', 'assistant')),
  text             text not null,
  -- Documents sent with a message: [{ "id": "...", "name": "..." }]
  attachments      jsonb not null default '[]'::jsonb,
  -- Buttons under a reply: links to screens, and answers to a question.
  links            jsonb not null default '[]'::jsonb,
  choices          jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);
create unique index if not exists agent_messages_position_idx on agent_messages (conversation_id, position);

do $$
declare
  t text;
begin
  foreach t in array array['agent_conversations', 'agent_messages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_org_isolation', t);
    execute format(
      'create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))',
      t || '_org_isolation', t
    );
  end loop;
end $$;
