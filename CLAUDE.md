# Handoff notes for Claude

Read this first in any new conversation about Stratios. README.md covers setup, how organizations
work and how data is isolated; this file covers how we work and where things stand.

## About the owner

- Ronnie is non-technical and on Windows. He prefers that Claude does the work end to end rather
  than handing him commands. Explain things in plain words and skip the jargon.
- Use US spelling in the UI ("Color", "Organize").
- Headers, nav items and panel titles use Title Case ("Org Colors", "Add an Asset"); sentences,
  and helper text stay in sentence case. Buttons and menu items are Title Case too ("Add Asset").
- Font: Inter for everything (`app/layout.tsx`). Headings and buttons use `--font-display`, which
  `globals.css` points at the body font; Space Grotesk, IBM Plex Sans, Satoshi and Roboto were tried and dropped.
- Never ask him to paste secrets (Clerk secret key, database connection string, Anthropic API key)
  into the chat. Secrets live only in `.env.local` on his computer (created by `keys.bat`) and in
  Vercel environment variables.

## Where things live

- Code: GitHub `ronniejcook-create/stratios`, branch `main`. On his computer:
  `C:\Users\Digi3D\Documents\stratios`. He runs it locally with `start.bat` (installs and starts
  `npm run dev` on http://localhost:3000).
- Hosting: Vercel, auto-deploys every push to `main` to **https://dev.stratios.app** (DNS CNAME on
  the `stratios.app` domain he registered). Vercel env vars must be enabled for Production *and*
  Preview, not only Development (that mistake once caused a 500).
- Auth: Clerk (test/development keys for now). Organizations on, membership optional,
  user-created organizations off, email verification on. The Vercel–Clerk integration failed to
  provision; we set the env vars by hand instead.
- Database: Supabase Postgres. Locally the Session pooler string; on Vercel the Transaction pooler
  (port 6543). Migrations in `db/migrations/` are run by pasting into Supabase's SQL editor.
- AI: Claude API called with plain `fetch` in `lib/brandColors.ts` (default model
  `claude-sonnet-5-5`, override with `ANTHROPIC_MODEL`). The key is workspace-scoped; the optional
  `ANTHROPIC_WORKSPACE_ID` header is supported.

## How changes are delivered

1. Edit and commit in the cloud workspace, ending commit messages with the attribution lines the
   session provides, then push to `main` (Vercel deploys from there).
2. If his computer is linked, also copy changed files to his folder: stage them in a fresh
   `/mnt/user-data/outputs/push-<timestamp>/` folder, write them with `device_commit_files`
   (force), then stage them back and diff (strip `\r`) to confirm. Reusing an old staging folder or
   running copies in parallel once delivered stale files.
3. npm can't reach the registry from the cloud workspace, so the app there can't be built or run;
   say so and ask him to check the result on localhost or dev.stratios.app. What can be checked:
   - SQL and the data layer: Postgres 16 is installed (`/usr/lib/postgresql/16/bin`, run as the
     `postgres` user). Run the migrations on a scratch database and exercise `lib/records.ts` and
     `lib/fields.ts` with `tsx`; they take a `client` argument so a small stand-in that shells out
     to `psql` works. Use a role without BYPASSRLS to prove organizations can't see each other.
   - Types: global `tsc` with hand-written stand-ins for next, react, Clerk and pg catches
     mistakes in our own code.
   - Layout: a static HTML mock using `app/globals.css`, screenshotted with Playwright.
   - The real build: after pushing, `gh api repos/ronniejcook-create/stratios/commits/<sha>/status`
     shows whether Vercel built it.

## What's built

- Landing page (`app/page.tsx`) with the dot-to-dot "S" logo (`components/Logo.tsx`, also the
  favicon). Sign up / Sign in open as Clerk pop-ups; `/sign-in` and `/sign-up` are Stratios-branded
  pages (`components/AuthFrame.tsx`) for invitation and email links.
- Clerk is styled with Stratios colors via `appearance` in `app/layout.tsx`. "Secured by Clerk"
  needs a paid Clerk plan to remove; "Development mode" goes away with production keys.
- Onboarding by email domain: a new domain gets the "Set up your organization" screen; a known
  domain is told to ask for an invitation; public domains (gmail etc., `lib/domains.ts`) never match.
  Creating an organization asks Claude for brand colors (by company name first, website second),
  saves a dark theme, and lands the person on Admin Settings.
- Signed-in workspace (Framer-style): `components/AppShell.tsx` with left nav (`SideNav.tsx`:
  Portfolio, and Admin Settings for `org:admin` only) and a right AI Agents column
  (`AgentPanel.tsx`, Portfolio Analyst marked "Coming soon"). Header reads
  "Stratios *for Org name*" with a drop-down only when the user belongs to more than one org.
- Data design: agreed in the Claude Doc "Stratios Data Design" (two tabs: the design, and the
  starter fields). Read it before touching the data model. Stage 1 of its build order is built:
  - `db/migrations/003_fields.sql`: Asset > Property > Building > Floor > Unit, addresses,
    source types, the field dictionary with 32 Stratios standard fields (org_id null), per-setting
    organization overrides, golden-record values, change history and per-source values.
  - `lib/records.ts` (hierarchy, keys), `lib/fields.ts` (dictionary, save with history),
    `lib/fieldFormat.ts` (format and parse, browser-safe), `lib/assets.ts` (new asset = asset +
    one property + one "Main Building").
  - Assets list (`app/dashboard/page.tsx`) links to the asset page
    (`app/dashboard/assets/[id]/`): fields grouped per asset, property and building, inline edit
    with an optional note, per-field history, monthly fields with a month picker, and adding
    properties, buildings, floors, units and addresses.
  - Stage 2 is built too: `db/migrations/004_sections_and_lists.sql` (screens, sections,
    section_fields, field_lists, field_list_rows; `list_id` and `default_value` on
    field_definitions; the standard layout and the Comments and Critical Dates lists on assets and
    properties). `lib/layout.ts` reads screens and sections; `lib/lists.ts` reads and saves list
    rows (each cell goes through `saveManualValue` with a `rowId`, so it has history; removing a
    row hides it, nothing is deleted). The asset page has screen tabs (`ScreenTabs.tsx`; every screen is rendered up front and
    switched in the browser, because a server round trip per tab felt sluggish): Overview,
    Financials (KPIs as tiles), Dates and Commentary (lists, `ListSection.tsx`). Fields not placed
    in any section show under "Other Fields" on the first screen.
  - Click-to-reference: clicking a field's name or a list row's number adds its permanent address
    (`property:key.fieldKey@2026-03`, `asset:key.comments[2]`) to the agent column
    (`components/AgentContext.tsx`, provided by `AppShell`, shown in `AgentPanel`). The analyst
    itself is still not connected.
  - Field keys are unique within a record type, so list columns carry their list in the key
    (`commentDate`, `criticalDateType`).
  - Standard rows have org_id null. Migrations lift FORCE row-level security on the dictionary
    and layout tables while seeding them and put it back, so they work for an owner role without
    BYPASSRLS and are safe to re-run in any order.
  - Stage 3, part 1 is built (no migration needed): Admin Settings > "Fields and Layout"
    (`app/dashboard/fields/`, admins only; logic in `lib/fieldAdmin.ts`). Admins can add a field
    (key generated in camel case, unique within the record type, never reused), edit a field's
    settings, move it to another section, remove a field they added (it is retired, values kept),
    and add screens, sections and lists (a list's columns are added as fields).
    Editing a Stratios standard field writes `field_settings` rows only for settings that differ
    from the standard; each row is the "Modified" flag, shown with the standard value and a Reset.
    `listFields` applies them and exposes `modifiedSettings` and `standardValues`. An
    organization's own `section_fields` row for a field replaces the standard placement.
    Standard sections and screens can't be renamed, reordered or hidden yet.
  - Stage 3, part 2 is built: roles and field permissions.
    `db/migrations/005_roles_and_permissions.sql` adds `roles`, `member_roles` and
    `field_permissions`; logic is in `lib/permissions.ts`; admin screens are Admin Settings >
    "Roles and Permissions" (`app/dashboard/roles/`).
    - Clerk `org:admin` always has full access. Everyone else gets the built-in Member role
      (one row per org with `is_member`, created on first use, default level **view**) plus any
      roles an admin assigns. Levels are hidden / view / edit. A field's level per role is its
      field rule, else its section's rule, else the role default; the most generous role wins.
      Lists follow their section. A role whose default is edit may also add records and addresses.
    - Enforced on the server: the asset page drops hidden fields before rendering (so they never
      reach the browser) and marks view-only ones; every save action re-checks with `loadAccess`
      and `sectionOfField`. History follows the field's level.
    - Not done yet: the agent isn't connected, so "agents follow the same rules" and "a KPI built
      from a hidden field is hidden" still have to be honored when the analyst and formulas arrive.
  - Stage 3, part 3 is built: the Master Library (`app/dashboard/library/`, nav group "Stratios
    Admin"), where Stratios staff manage the standard fields and layout for every organization.
    - Who gets it: administrators of the Stratios organization. `lib/stratios.ts` decides that by
      the organization's company domain being `stratios.app` in `organization_settings`, or its id
      matching the optional `STRATIOS_ORG_ID` env var. The Stratios org was created by hand in
      Clerk (`org_3KORIXREU8taMpsPwTA1obv5xRL`, no @stratios.app mailbox exists yet), so
      `db/migrations/006_master_library.sql` records its domain. Everyone else gets "not found".
    - How writes are allowed: migration 006 adds policies that let a transaction change org_id-null
      rows only when `app.stratios_admin` is `on`; `withStratiosAdmin` in `lib/db.ts` sets it, and
      is only called after `isStratiosAdmin`. Passing null as the organization to `listFields`,
      `listScreens`, `listLists`, `createField`, `createScreen`, `createSection`, `createList`
      means "the standard itself". New standard keys are checked against every organization's.
    - A change is live for all organizations at once; settings an organization modified keep
      their value (that is just how `field_settings` overrides already work).
  - Not built yet (later stages): documents and extraction, formulas
    (calculated fields show "Calculated later"), tenants, leases, rent roll, cash flow, feeds and
    the source waterfall. Only Manual Entry writes values today. There is no history view for a
    single list cell yet (the history is stored).
- Members page (admins): invite by email, roles.
- Admin Settings (`app/dashboard/settings/`, the page and nav item are titled "Org Colors"):
  - Site Colors: 10 roles, Dark/Light toggle, hex editing, 16 presets (`lib/presets.ts`),
    "Org Colors" with the AI icon (the generated brand colors; persisted, not re-fetched), "Stratios". Unsaved changes are preview
    only and revert on leaving the page. "Reset Colors" (beside Save in both editors) puts back the
    last saved colors; it is disabled when nothing has changed.
  - Graph Colors: 8 slots, pie and bar previews side by side, "Other Themes" chips including
    Org Colors (AI icon) and 31 presets. Palettes were checked for contrast and color-blind
    separation.
- Search engines are told not to list the site (`robots` in `app/layout.tsx` and the
  `X-Robots-Tag` header in `next.config.ts`). Remove both when the public site launches.
- Signed-in visitors to `/` are sent straight to `/dashboard` (`app/page.tsx`).
- Signed-in pages use compact sizing matched to the side columns (14px text, 36px controls,
  16px panel padding); the overrides are the `.shell-main ...` block at the end of `globals.css`.
- Theme logic: `lib/theme.ts` (roles, contrast, derive from two brand colors), `lib/chartColors.ts`.
  Settings storage: `lib/orgSettings.ts` (`organization_settings` table; falls back to Clerk
  metadata without a database).

## Ideas offered but not started

- Wire up the Portfolio Analyst agent.
- Document uploads (Supabase Storage) and a richer asset model (properties, leases, financials).
- A read-only member list for non-admins.
- Before real customer data: a restricted database role without BYPASSRLS, production Clerk and
  Supabase projects, and a paid Vercel plan.
