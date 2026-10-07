# Stratios

Commercial real estate portfolio intelligence. This repository holds the landing page and the
start of the application: sign-in, invite-only organizations, and an organization-scoped assets list.

- **Next.js 16** (App Router, TypeScript)
- **Clerk** for sign-in, organizations, roles and email invitations
- **Postgres** with row-level security so each organization only sees its own rows

> This first version was written without being installed or run. Expect to fix small issues on the
> first `npm install` / `npm run dev`.

## Run it locally

1. Install: `npm install`
2. Copy `.env.example` to `.env.local` and fill in the values (see below).
3. Create the tables: run `db/migrations/001_init.sql` against your database
   (`psql "$DATABASE_URL" -f db/migrations/001_init.sql`, or paste it into your provider's SQL editor).
4. Start: `npm run dev`, then open http://localhost:3000

## Clerk setup

1. Create an application at https://dashboard.clerk.com and copy the publishable and secret keys
   into `.env.local`.
2. Enable **Organizations**.
3. Turn off personal accounts (require organization membership), so every user works inside an
   organization.
4. Leave verified-domain auto-join switched off. Colleagues join by invitation only, sent from the
   Members page.

## How organizations work

- An **organization** is a company account. Every asset row stores its organization ID.
- After sign-up, `/onboarding` looks at the domain of the person's verified email address.
  - **New domain:** they are prompted to set up their organization and become its admin. The domain
    is saved on the organization (Clerk public metadata, `domain`).
  - **Domain already registered:** they are told to ask an admin of that organization for an invitation.
    They are not added automatically.
  - **Public email providers** (gmail.com, outlook.com, ...) are never matched; see `lib/domains.ts`.
- Colleagues join through an **email invitation** from an admin (`/dashboard/members`).
- People who already have a membership or a pending invitation go to `/select-organization`.
- In Clerk, turn off the setting that lets users create organizations themselves, so the only way to
  create one is the onboarding screen.

## How data is isolated

- `proxy.ts` requires sign-in for `/dashboard` and `/select-organization`.
- Server code reads the organization ID from the Clerk session, never from user input.
- `lib/db.ts` runs each request in a transaction that sets `app.org_id`; the row-level security
  policy in the migration limits every query to that organization.
- Queries also filter by `org_id` explicitly.

**Important:** row-level security is skipped for database roles with the `BYPASSRLS` attribute or
superuser rights (the default owner role on some hosted providers has this). Point `DATABASE_URL`
at a dedicated role without it, for example:

```sql
create role stratios_app login password '<choose one>';
grant select, insert, update, delete on assets to stratios_app;
```

## Project layout

```
app/page.tsx                 landing page
app/sign-in, app/sign-up     Clerk sign-in and sign-up
app/select-organization      choose, create or join an organization
app/dashboard                signed-in app (assets, members)
lib/db.ts, lib/assets.ts     organization-scoped database access
db/migrations                SQL schema
proxy.ts                     route protection
```
