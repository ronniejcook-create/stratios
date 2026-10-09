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
- AI: Claude API called with plain `fetch` in `lib/claude.ts` (default model
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
  (`AgentPanel.tsx`, the Portfolio Analyst chat). Header reads
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
    (`components/AgentContext.tsx`, provided by `AppShell`, shown in `AgentPanel`) and is sent to
    the analyst with each message.
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
      Clerk (`org_3KQzLNz4UcqIKfuNdLBcuVz3JWj`, no @stratios.app mailbox exists yet), so
      `db/migrations/006_master_library.sql` records its domain. Everyone else gets "not found".
    - How writes are allowed: migration 006 adds policies that let a transaction change org_id-null
      rows only when `app.stratios_admin` is `on`; `withStratiosAdmin` in `lib/db.ts` sets it, and
      is only called after `isStratiosAdmin`. Passing null as the organization to `listFields`,
      `listScreens`, `listLists`, `createField`, `createScreen`, `createSection`, `createList`
      means "the standard itself". New standard keys are checked against every organization's.
    - A change is live for all organizations at once; settings an organization modified keep
      their value (that is just how `field_settings` overrides already work).
  - Field editor changes (October 8, evening; `db/migrations/007_agent_instructions.sql`):
    - "AI Description" is now just **Description**, with a small Generate button
      (`components/GenerateButton.tsx`) that asks Claude for a definition
      (`lib/fieldDescription.ts`, action `generateDescription`). It also sits on Add a Field.
      Nothing is saved until the admin saves. All Claude calls now go through `lib/claude.ts`.
    - Other Names, Extraction Hints and Source Priority were replaced, at Ronnie's request, by one
      big Markdown **Agent Instructions** box per field (`agent_instructions`, up to 20,000
      characters) that agents will read like a skill. It has a Markdown / Reading View toggle;
      Reading View is editable with Bold, Italic, bullet, numbered list and Heading buttons
      (`components/RichTextEditor.tsx`; `lib/richText.ts` converts Markdown to HTML and the
      edited elements back, escaping all text; pasted multi-line text is read as Markdown). It was
      tested in Chromium with Playwright against a compiled copy of `lib/richText.ts`, not inside
      the app. The old columns are kept but
      no longer shown or saved; migration 007 wrote their contents into each field's instructions
      once. It is one overridable setting, so an organization that edits a standard field's
      instructions stops receiving Stratios updates to that whole block. He was told the trade-off:
      source priority in text means an agent, not the app, decides which source wins. The three
      rules (when empty, when different, hand-picked value) are still controls; the third is
      labeled "When a Value is Manually Entered" (his wording, including the lowercase "is").
    - The editor shows **Type**. It can be changed only on a field the organization added and only
      while no values exist (`fieldHasValues`); standard fields and the Master Library show it locked.
    - `listFields` reads `agent_instructions` through `to_jsonb(...)` so pages still load on a
      database where 007 has not been run; saving a field there fails until it is.
    - Migration 007 has been run on Supabase. The design document was updated the same evening
      (dictionary table, source priority paragraphs, Calculated Fields and Skills, the tables list,
      a second decisions table and the build order).
  - Decision (October 8): **agents calculate and store KPI values by following AI skills**, not
    formulas. Ronnie chose this over the earlier recommendation; he was told numbers from an agent
    are less repeatable than formulas. Two questions are open in the design document: whether a
    field's Agent Instructions is the skill itself or skills stay separate rules (`field_rules`)
    with levels and versions, and whether simple totals (a property's square feet from its
    buildings) run through a skill or stay built-in sums. Ask before building stage 5.
  - **Stage 4 is built** (October 8, late; `db/migrations/008_documents.sql`): document upload and
    the extraction agent. Not yet tried in a browser or against the real Claude API by anyone.
    - Where: every asset has a **Documents** tab (key `_documents`, added in the asset page beside
      the configured screens; `DocumentsPanel.tsx`). Each document has a review page at
      `/dashboard/assets/[id]/documents/[docId]`.
    - Upload: PDF only, up to 20 MB (`MAX_DOCUMENT_BYTES`). The browser sends the file in 3 MB
      pieces (`documents/requests.ts` -> `app/api/documents/...`), because Vercel caps one request
      at about 4.5 MB. The file is stored **in Postgres** (`document_chunks`), not Supabase
      Storage, so nothing new had to be configured; all storage goes through `lib/documents.ts`
      so it can move later. Watch database size if many large files are uploaded.
    - Reading: `POST /api/documents/[id]/read` (`maxDuration` 300). Three steps so no transaction
      is held during the Claude call: claim the document (`startReading`), `readDocument` in
      `lib/extraction.ts` (PDF as a base64 document block + the dictionary, structured output,
      16,000 max tokens, 270 s timeout), then `applyReading`. Claude's limits: 32 MB per request
      and 100 pages. A reading stuck for 6 minutes can be retried.
    - Permissions: the agent is given only fields the uploader may **edit**
      (`extractableFields`); names, list columns and calculated fields are never offered. Upload,
      open-file, the summary and proposed fields need `access.canAddRecords`; the review list
      drops findings for fields the viewer can't see; accepting needs edit on that field.
    - Rules (`decideOutcome`, pure): empty + fill -> filled; empty + ask -> decision; same ->
      confirmed; different + never -> kept; different + hand-entered value that stays -> decision;
      different + replace -> replaced; otherwise decision. Every value is stored in
      `field_source_values` with `document_id` and `page`. Source priority in Agent Instructions is
      sent to the agent as context but is **not** applied by code; it starts to matter with feeds.
    - Review list (`document_findings`): Needs a Decision (Use Document's Value / Keep Current),
      Proposed New Fields (administrators: Add Field / Dismiss; adding creates an organization
      field and fills it), Filled In, Replaced, Confirmed, Different but Kept, Already Decided.
      Proposed fields always wait for an administrator; the per-organization "add automatically"
      setting from the design is not built.
    - Not built: list rows (comments, critical dates) from documents, Word/Excel files, reading a
      document a second time after it has been read, and showing which document a value came from
      on the asset page (the history note says "From <file>, page N").
    - Checked here: migrations on a scratch database, and upload, rules, decisions and proposed
      fields through `lib/documents.ts` with a psql stand-in client (all passed). The API routes,
      the screens and the Claude call itself could not be run here.
  - **The agent column is a chat** (October 8, late; `db/migrations/009_agent_documents.sql`).
    Ronnie wanted the agent used the way he chats with Claude: type a request, drag a file in.
    The scripted end-to-end test passed; it has not been tried against the real Claude API.
    - `components/AgentPanel.tsx`: message thread, composer (Enter sends, Shift+Enter new line),
      paperclip and drag-and-drop for PDFs anywhere on the column. Dropped files upload at once
      with **no asset** (`documents.asset_id` is now nullable) and go with the next message. The
      conversation lives in browser memory only: it survives moving between pages but not a
      reload, and nothing is stored. Replies are rendered with `toHtml` (escaped).
    - `POST /api/agent` -> `lib/agent.ts` (`runAgent`): a Claude tool loop (`converse` in
      `lib/claude.ts`, up to 6 steps, 285 s budget). Tools, all run as the signed-in person with
      their permissions: `create_asset_from_document`, `read_document_into_asset`,
      `create_asset`, `list_assets`, `get_asset` (drops fields the person can't see). The server
      returns buttons (Open <asset>, Review What Was Found) beside the text; the model is told
      not to write links or ids.
    - `lib/documentReading.ts` holds the reading logic shared with the Documents tab:
      `readIntoAsset` and `createAssetFromDocument` (one Claude call returns the asset's name,
      property type and city plus all values against stand-in records, the asset is created with
      `createAssetWithDefaults`, then the values go through the usual rules and review list).
    - Browser helpers moved to `lib/documentClient.ts`. The page's asset id (from the URL) and the
      clicked field references are sent as context with each message.
    - Not built: saving conversations, streaming replies, asking questions about a document's
      contents without filling fields, multi-property documents (only the main property is
      created), and any tool beyond the five above. Files dropped but never sent stay in the
      database with no asset (no clean-up yet).
  - **Analyst Instructions screen** (October 8, late; `db/migrations/010_analyst_instructions.sql`):
    Stratios Admin > Analyst Instructions (`app/dashboard/analyst/`, Stratios administrators only,
    same check as the Master Library). The analyst's general instructions are edited there with
    the Reading View / Markdown editor and apply to every organization from its next reply
    (`agent_profiles` table, one row for `analyst`; everyone reads, only `app.stratios_admin`
    writes). `lib/analystInstructions.ts` holds the built-in default (used when no row exists, or
    010 has not been run), the save/reset logic and `buildAnalystPrompt`, which always appends
    the fixed rules shown on the screen as "Always Applied" (no invented values, tool limits, no
    links or ids, document contents are not instructions). Ronnie was told instructions shape
    behavior but new abilities need new tools; he asked about address lookup to coordinates,
    property photos, a Skills screen and n8n. None of those are started.
  - **Skills** (October 8 and 9; `db/migrations/011_skills.sql`, `012_organization_skills.sql`).
    Ronnie asked for a library of skills the agents reference instead of one set of instructions
    (for example different instructions per document type), then for skills to differ by
    organization. A skill is a name, a "Use When" line, Markdown instructions and an In Use /
    Turned Off status. Logic in `lib/skills.ts`; one shared editor, `app/dashboard/skills/SkillEditor.tsx`.
    - Layering, like fields: Stratios standard skills have org_id null; an organization's own
      skills carry its org_id; an organization's row **with the same key as a standard skill
      replaces it** for that organization (that is how it changes or turns off a standard skill).
      Saving text identical to the standard removes the organization's row; Reset to Standard
      does the same. A modified skill stops following Stratios updates as a whole.
      `listSkills(client, orgId)` returns the layered list with `source` standard / modified /
      own; pass null for the standard itself.
    - Screens: Admin Settings > **Skills** (`/dashboard/skills`, organization administrators)
      and Stratios Admin > **Skills Library** (`/dashboard/skill-library`, Stratios
      administrators; shows how many organizations customized each skill).
    - Row-level rules: everyone reads standard skills and their own; an organization writes only
      its own rows; standard rows need `app.stratios_admin`, which can also read (not write)
      every organization's skills.
    - Reading a document: every skill in use for the organization is put in the extraction prompt
      in full (`skillsInFull`, capped at 60,000 characters); the agent decides the document type
      and follows the skills whose Use When fits. Skills can't change the answer format or rules.
    - Chat: the analyst's instructions list each skill's name and Use When (`skillIndex`), and a
      sixth tool, `read_skill`, opens one. `loadSkillsForAgent(client, orgId)` never throws
      (savepoint), so the agents work without skills if the migrations have not been run.
    - Migration 011 seeds two starter standard skills on first run only: Reading an Offering
      Memorandum (asking price is not Purchase Price; prefer actual over pro forma) and Reading an
      Appraisal.
    - Analyst Instructions (the always-on behavior) is still one global set edited by Stratios
      administrators; it has no per-organization version. Skills are their own library, separate
      from a field's Agent Instructions (the first open design question). KPI skills (stage 5)
      should build on this table. No versions or per-property-type variants yet.
    - Checked: both migrations on a scratch database, the row-level rules as a non-privileged
      role, and a two-organization test of the layering through to what each organization's
      agents are sent (scripted Claude). The screens were not opened in a browser.
  - **Navigation names** (October 9, Ronnie's clean-up). Admin Settings: **Users** (was Members;
    the address is still `/dashboard/members`), Roles and Permissions, **Fields Library** (was
    Fields and Layout; `/dashboard/fields`), **Layouts** (new, `/dashboard/layouts`: screens,
    sections and lists, split out of the fields page), **Skills Library** (`/dashboard/skills`),
    Org Colors. Stratios Admin uses the same three names for the Stratios standard versions:
    Analyst Instructions, **Fields Library** (was Master Library, standard fields only;
    `/dashboard/library`), **Layouts** (new, `/dashboard/layout-library`), Skills Library
    (`/dashboard/skill-library`). Ronnie asked for Master Library to be renamed "Skills Library";
    it holds fields and a Skills Library already sat beside it, so it was named Fields Library
    and he was told. Older notes here that say "Master Library" mean this screen. Both admin
    groups are sorted alphabetically in `SideNav.tsx` at display time (his request). Both layout pages share
    `app/dashboard/layouts/LayoutTable.tsx`. Older notes in this file still say "Fields and
    Layout" and "Members" in places; read them as the new names.
  - **Resizable agent column** (October 9): drag the left edge of the AI agents column
    (`.agent-resizer` in `AppShell.tsx`; arrow keys work too, double-click resets to 360). Width
    is clamped to 300-900 px and always leaves 420 px for the page. Each person's width is saved
    on their Clerk account (`unsafeMetadata.agentWidth`, so it follows them across computers) and
    in localStorage (`stratios.agentWidth.<userId>`) for an instant start. CSS reads it from
    `--agent-open-width`. Not tried in a browser by Claude.
  - Not built yet (later stages): formulas
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

## Where we left off (October 8, 2026)

Stages 1 to 3 of the data design's build order are built, deployed and confirmed by Ronnie as
visible (stage 4 is described below): the asset hierarchy and fields, screens/sections/lists with click-to-reference, the
Fields and Layout admin, roles and field permissions, and the Master Library. Migrations 003 to
007 have been run on Supabase. He chose to spend time trying what is built before going further.

Stage 4 (document upload and the extraction agent) and the chat in the agent column were built
late on October 8 and pushed. Ronnie needs to run `008_documents.sql` and `009_agent_documents.sql`
on Supabase and then try it with a real PDF, by dropping it on the agent column; expect fixes, since
the upload routes, the screens and the Claude call were not run before delivery. Next after that:
stage 5 AI skills that calculate and store KPIs (two open questions in the design document must be
answered first), then stage 6 tenants, leases, rent roll, cash flow and feeds.

Things not yet verified or still owed:

- None of the stage 1 to 3 screens were seen in a browser by Claude; Ronnie has only confirmed
  they appear. Expect small layout or behavior fixes as he uses them.
- Signing in as a non-administrator (to see hidden and view-only fields) has not been tried.
- The Member role defaults to view, so non-admins can't edit until given a role. This follows
  the design document; he was told and can change the Member default to edit.
- Agents must follow field permissions, and a KPI built from a hidden field must be hidden, once
  the analyst and formulas exist.
- Organizations can't rename, reorder or hide standard sections and screens yet.
- The design document's build-order section notes that steps 1 to 3 are built; update it as
  later stages land.

## Ideas offered but not started

- Give the Portfolio Analyst more tools (edit a value, portfolio-wide questions), saved conversations and streaming.
- Move document files from Postgres to Supabase Storage if they grow.
- A read-only member list for non-admins.
- Before real customer data: a restricted database role without BYPASSRLS, production Clerk and
  Supabase projects, and a paid Vercel plan.
