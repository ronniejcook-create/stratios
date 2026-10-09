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
   running copies in parallel once delivered stale files. PNG pictures copied this way gain a
   provenance tag (an extra `caBX` chunk), so they are larger on his computer and won't compare
   byte for byte; the picture itself is unchanged, and GitHub and Vercel have the originals.
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
    source types, the field dictionary with 32 Stratios standard fields (org_id null; 54 since migration 017), per-setting
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
  - **Both stage 5 questions are answered** (October 9, Ronnie): (1) a KPI's recipe lives on
    the field itself, in its Agent Instructions; there is no separate `field_rules` table.
    (2) Calculation starts from a **trigger event**, such as a rent roll being uploaded. A
    **skill** tied to that event says *which* values to calculate; the logic for each value is
    in that field's Agent Instructions. He did not ask for built-in sums, so simple totals go
    the same way unless he says otherwise. He also confirmed (October 9) that migrations 013 to
    017 are run, the Census key is in Vercel, and a fresh offering memorandum was read with the
    new fields, commentary and address. Still open: whether rent roll storage (tenants, leases)
    is built before the first KPI skill, or the first version calculates straight from the
    uploaded document.
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
    - Not built: Word/Excel files, reading a
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
  - **Review list messages** (October 9): on the document review page, the "it worked" message
    for Add Field / Dismiss / a decision shows at the top of its section (`ReviewNotices` and
    `ReviewSection` in `ReviewControls.tsx`), because the row leaves the table on success and a
    message on the row flashed and vanished. A section whose last row was just settled stays
    until the message is dismissed or the page is reloaded. Errors still show on the row.
  - **Spreadsheet-style grids** (October 9, Ronnie's requests): the Assets list and both Fields
    Library pages use one shared grid, `components/DataGrid.tsx` (`DataGrid`, `Modal`). Pages
    build plain `GridRow`s on the server (`cells` text per column, optional `order` numbers for
    counts or a natural order, `values` for cells holding several values such as an asset's
    types and cities, `tones` for chips). Each column heading opens an Excel-like menu
    (`ColumnMenu`: Sort A to Z / Z to A, or Smallest / Largest for numbers; Clear Filter; a
    search box and tick boxes for the column's values with Select All; OK / Cancel; a column's
    list shows the values left by the other columns' filters; empty cells are "(Blank)"). There
    is also a search box and "Clear Filters and Sorting". All in the browser, nothing is
    remembered between visits. Excel's Sort by Color and Text Filters were left out.
    - Fields Library (`app/dashboard/fields/FieldsGrid.tsx`): "Belongs To" is a column instead
      of a table per level. Assets (`app/dashboard/AssetsGrid.tsx`): Name, Properties, Type, City.
    - **Add Field** and **Add Asset** are buttons at the right of the search row that open a
      pop-up (`Modal`, a native `<dialog class="modal">`; reuse it for future pop-ups). Add
      Field closes with a message above the grid; Add Asset opens the new asset as before.
    - Use `DataGrid` for other lists (Users, Skills, Layouts) if he asks for the same there.
    - The real components were clicked through in Chromium with Playwright using stand-in rows
      and forms, not inside the app.
  - **Delete an asset** (October 9; no migration): administrators (`org:admin`) get a Delete Asset
    button beside the asset's title (`DeleteAssetButton.tsx`). A pop-up lists what goes (counts
    from `getAssetContents`) and asks "This cannot be undone. Are you sure?". `deleteAsset` in
    `lib/assets.ts` removes field values, history, per-source values and list rows for every
    record under the asset (they have no database link to their record, so they are deleted by
    id first), then the asset; properties, buildings, floors, units, addresses and documents
    with their files and review lists follow by cascade. It is a real, permanent delete in one
    transaction: no recycle bin and no audit record beyond a server log line. Tested on the
    scratch database (two assets plus another organization: only the chosen asset's rows go,
    another organization can't delete it). The button and pop-up were checked as a mock only.
    Any new table that stores rows by `record_id` must be added to `deleteAsset`.
  - **Photos** (October 9; `db/migrations/013_photos.sql`, table `asset_photos`). Ronnie asked
    whether photos could be added when an offering memorandum is read; a test on his Knoll Trail
    memorandum pulled 29 clean photos, so it was built.
    - Extraction: `lib/photoExtraction.ts` uses **pdf-lib** (the first dependency added since the
      start; `package.json` only, the lock file could not be updated here because npm is
      unreachable, Vercel's install resolves it). It copies out pictures stored as plain JPEG,
      at least 600 x 400, not banners, not print (CMYK) color, up to 40 per document. Logos and
      icons fall away by size. Maps and floor plans are not pictures in the file, so they come in as page
      pictures instead (below); a flattened brochure yields little by this route.
    - Labels: the reading's answer format gained `photos` (page, category, caption) and
      `main_photo_page` (`lib/extraction.ts`); pictures are matched to the agent's notes by page.
      Categories: exterior, interior, aerial, area, plan, other. Two-page spreads are joined (below);
      near-duplicates are kept. Exact duplicates are skipped by fingerprint (`sha256`).
    - When: `addPhotos` in `lib/documentReading.ts` runs after a reading is saved, for both the
      chat agent and the Documents tab, in its own step; a failure there (or 013 not run) never
      fails the reading. The analyst is told how many photos were added.
    - Storage: the picture bytes are in Postgres (`asset_photos.data`), as agreed with Ronnie for
      now; move photos and documents to Supabase Storage together later. Roughly 4 MB per
      memorandum. `lib/photos.ts` holds all reads and writes.
    - Screens: a **Photos** tab on the asset (`PhotosPanel.tsx`): cards with category, caption
      and source, click for a larger view, Set as Main, Edit, Remove, a category filter, Add
      Photos and drag-in upload (shrunk in the browser to 2,000 px JPEG, then `POST
      /api/photos`), and **Get Photos from Documents** for documents read before photos existed
      (no agent call, so no captions). The main photo shows beside the asset's title and as a
      thumbnail in the Assets list (`DataGrid` `thumbnails`). Photos are served by
      `GET /api/photos/[id]` to signed-in members of the organization.
    - **Plan and map pages** (October 9, later; `db/migrations/014_document_photo_notes.sql`):
      floor plans, stacking plans and maps are drawings inside a PDF, not pictures that can be
      copied out, so the whole page is drawn and saved as a JPEG under Plan or Map. The drawing
      happens **in the browser** (`lib/pagePictures.ts`) with PDF.js served as plain files from
      `public/pdfjs/` (legacy build 6.2.108, loaded by a small module script so it stays out of
      the bundle; not in package.json). Drawing on the server with a native canvas was tried in
      the workspace and dropped as too fragile to ship untested. Each picture goes to
      `POST /api/photos` with `documentId` and `page`; a page added twice is one photo
      (`file_name` "Page N" marks a page picture).
      - The agent's notes are kept on the document (`documents.photo_notes`, migration 014; read
        through `to_jsonb` so pages work before it is run). `planPagesOf` picks the plan pages.
      - Chat: the reply carries `pages` and `AgentPanel` adds them in the background, with a
        status line. Photos tab: **Add Pages from a Document** (document, page list such as
        "18, 19, 28-30", prefilled with the agent's plan pages not yet added). That button also
        covers flattened memorandums and documents read before notes were kept. Reading from
        the Documents tab does not add plan pages by itself; the button shows them as waiting.
      - Needs `access.canAddRecords` (it opens the document file).
    - **Two-page photos are joined** (October 9, later; no migration; Ronnie asked for it).
      `lib/photoJoin.ts` (`joinSpreads`) runs between extraction and saving, in `addPhotos` and
      in Get Photos from Documents. It compares the right edge of the biggest picture on one
      page with the left edge of the biggest on the next: equal heights, edge difference of 10
      or less, and edges that are not blank. On his memorandum the 9 real pairs scored under 6
      and unrelated neighbors over 27 (29 photos became 20). The joined JPEG sits on the left
      page. Uses **sharp** (added to `package.json`; Next already had it in the lock file),
      loaded with a dynamic import inside a try: if it is missing or fails on the host the
      photos simply stay in halves, with a line in the server log. `savePhotosFromDocument`
      swaps out halves saved by an earlier reading (matched by fingerprint, `replaces`) and
      carries over their caption, label and main-photo place. There is no manual Join button
      and no way to split a wrong join other than removing the photo.
    - Permissions: everyone in the organization sees photos; adding, editing and removing need
      `access.canAddRecords`, like documents. Deleting an asset deletes its photos (cascade);
      removing a document keeps the photos that came from it.
    - Checked for joining: his memorandum joined correctly (looked at all 9), the same result
      twice, and saving and half-replacement on the scratch database. sharp could not be run on
      Vercel from here, so whether joining works there shows on his first try.
    - Checked for page pictures: 014 twice, notes and page-picture storage on the scratch
      database, and the real `lib/pagePictures.ts` in Chromium against a stand-in server with
      his memorandum (pages 18, 19 and 28 drawn and sent). Not run inside the app.
    - Checked: the migration twice on the scratch database, and extraction, labels, main photo
      choice, duplicates, upload, edit, remove and organization isolation through `lib/photos.ts`
      with his real memorandum (all passed). The screens were checked as a mock; the routes and
      the agent's photo notes were not run against the real app or Claude API.
  - **Address lookup and map coordinates** (October 9; `db/migrations/015_address_coordinates.sql`
    adds `latitude`, `longitude`, `location_source` to `addresses`). Ronnie found the five
    address boxes a pain and wants properties on a map later.
    - "+ Add Address" is now one box: type the address, **Find Address**, and the match (or a
      choice of up to five) is shown with its coordinates and a "Check on a Map" link, then
      **Add This Address**. Ronnie had the Suite box removed from this step (October 9); a suite
      is saved only when the picked Google suggestion has one, or through Enter It by Hand. "Enter It by Hand" keeps the old five boxes.
    - Lookup: `lib/geocode.ts` calls the **U.S. Census Bureau geocoder** from the server (free,
      no account or key, results may be stored). Limits he was told: United States only, no
      suggestions while typing, no suites, and the point is worked out along the street's house
      numbers, so it lands on the right block rather than exactly on the building. Google and
      Mapbox were not used because they need an account and a key, and their terms limit
      storing coordinates; swapping the service means changing only this file.
    - **Suggestions while typing** (October 9, later; Ronnie asked for Google type-ahead):
      `lib/googlePlaces.ts`, on when `GOOGLE_MAPS_API_KEY` is set (Vercel and `.env.local`;
      `.env.example` lists it). The box asks `suggestAddress` 250 ms after typing pauses
      (Places API (New) Autocomplete, street addresses and named buildings, one session token
      per round) and `pickSuggestedAddress` reads the picked place's address parts (Place
      Details with the field mask `id,addressComponents`). The key never reaches the browser.
      **Coordinates still come from the Census lookup, on purpose:** Google's terms allow
      coordinates from the Places API to be kept for 30 days only (checked against the Service
      Specific Terms, June 2026), and Stratios keeps them. Never add `location` to that field
      mask. An address Census doesn't know (new buildings, anything outside the U.S.) is saved
      without a location. If a suggestions call fails the box quietly stops asking and Find
      Address still works. "Powered by Google" shows under the list. The Google place id is
      not stored. He added the key in Vercel and confirmed suggestions work on dev.stratios.app
      (October 9). When Google refuses a request, its reason shows under the box.
    - Each saved address shows **Map** (opens Google Maps at the point) when it has coordinates,
      **Find Location** for one typed by hand (`locateAddress`: looks it up and saves the
      coordinates of the first match, leaving the text alone) and **Remove** (`removeAddress`;
      addresses could not be removed before). All need `access.canAddRecords`.
    - `insertAddress` saves coordinates only when the columns exist (`hasCoordinateColumns`), and
      the asset page reads them through `to_jsonb`, so everything works before 015 is run, just
      without locations. An asset created from a document starts with a city-only address, which the
      document's street address then replaces (see "One address per property and building").
    - **Map tab** (October 9, later; Ronnie asked for it): every asset has a Map tab (key `_map`,
      before Photos) with a pin for each property and building address that has coordinates
      (`components/PropertyMap.tsx`). One pin is shown at street level with its pop-up open;
      several are all fitted in view. A pin's pop-up has the name, the address and "Open in
      Google Maps". Drawn with **Leaflet 1.9.4** served as plain files from `public/leaflet/`
      (downloaded from the official GitHub release; loaded by a script tag, not in package.json)
      and **OpenStreetMap** street tiles, which need no key. Because tabs render hidden, the map
      is framed when its box first gets a real size (ResizeObserver). At his request the scroll
      wheel zooms the map (so the page doesn't scroll while the pointer is over it) and the map
      fills the height left on the screen below it (`fill` in the component, minimum 320 px). He was told: OpenStreetMap's free tiles are fine for testing
      but not meant for heavy commercial traffic, so pick a paid tile source or Google before
      real customers; there is no portfolio-wide map of all assets yet.
    - **Demographics on the map** (October 9, later; Ronnie asked for overlays and chose Census
      demographics with 1, 3 and 5 mile rings first). Beside the map, **Show Demographics**
      (`AssetMap.tsx`) loads `GET /api/demographics?addressId=` (takes an address of the
      organization, never raw coordinates) -> `lib/demographics.ts`:
      - TIGERweb (no key) gives the census tracts within five miles with simplified outlines;
        the **Census Data API** gives each tract's American Community Survey 5-year figures.
        The Data API now refuses every request without a key, so it needs a free key in
        **`CENSUS_API_KEY`** (Vercel and `.env.local`; signup at
        api.census.gov/data/key_signup.html). Without it the panel says so. It asks for the
        2024 survey and falls back to 2023. Answers are kept for a month by Next's fetch cache.
      - The map shades tracts by a chosen figure (median household income, population density,
        median age, share of homes rented, share of adults with a bachelor's degree or more) in
        five equal-count groups of one blue ramp, with a color key and a hover label per tract,
        and draws dashed rings. A table gives estimated population, households, average
        household income, renters and degrees within each ring. Ring totals apportion each
        tract by the share of its land inside the ring (`sharesWithin`, a 28 x 28 sample grid;
        within half a percent on a known shape). Medians can't be added up, which is why the
        rings show average income and the shading shows median income.
      - Nothing is stored on the property yet; he was told saving these as fields is the more
        useful next step, and that neighborhood demographics are sensitive where they bear on
        leasing or lending decisions (worth a word with counsel before customers see it).
        Crime, flood zones, traffic and other overlays he asked about are not started.
      - Checked: the arithmetic and the Census calls with scripted answers, and the real panel
        and map in Chromium with made-up figures. Never run against the real Data API (no key
        here); TIGERweb's field names were confirmed against a live answer.
    - Addresses on units are not listed with these actions or pinned (units show their address
      as a tooltip, as before).
    - Checked for the map: the real component in Chromium with the real Leaflet files and
      stand-in tile pictures (hidden tab then shown, one pin centered at zoom 16, three pins
      all in view, pop-up text safe from injected HTML). Real map tiles could not be loaded
      here, so he is the first to see the actual street map.
    - Checked for suggestions: the Google code with scripted answers, and the real form in
      Chromium with stand-in answers (typing, arrow keys, picking, slow answers, failure).
      Never run against Google itself: there is no key here.
    - Checked: the reading of a real Census answer for his Knoll Trail address, storage before
      and after 015 on the scratch database, organization isolation, and the real form and list
      in Chromium with a stand-in lookup. Whether Vercel can reach the Census service was not
      checked from here.
  - **Field blocks and the field pop-up** (October 9, later; Ronnie found label, value, Edit and
    History on one line unreadable). `FieldGroup.tsx` now shows each field as a block: the name
    on top, small and muted, and the value underneath in bold (he first asked for the reverse,
    then had it swapped; "Not set" and "Calculated later" stay light so gaps stand out). Clicking anywhere on a block opens
    a pop-up (`Modal`) with tabs **Edit** ("Value" when the field is view-only or calculated),
    **History** and **Skill Details** (type, key, Description and the field's Agent
    Instructions rendered with `toHtml`; administrators get a link to the field in Fields
    Library), and buttons **Copy to Agent** (what clicking the label used to do), **Save**,
    **Reset** (back to the saved value) and **Close**. Save keeps the pop-up open and says
    "Saved."; Enter saves. KPI tiles (Financials) use the same block with a larger value. Lists
    (Commentary, Dates) are unchanged, and still add references by clicking a row's number.
    "Skill Details" was taken to mean the field's own description and instructions, and he was
    told; the organization's skills library is not shown there. `FieldView` gained
    `description` and `agentInstructions`. Checked by clicking through the real component in
    Chromium with stand-in data; not inside the app.
  - **Starting values have history** (October 9, later; `db/migrations/016_starting_value_history.sql`).
    Ronnie opened History on Property Name for an asset the agent created from a memorandum and
    saw "No changes recorded yet... Manual Entry". Cause: `createAssetWithDefaults` saved the
    name and type through `saveManualValue`, which wrote no history when the value equaled the
    record's fixed column, and always as Manual Entry. Now `saveManualValue` takes `starting`
    (always write the first "Set to ..." entry) and `fromDocument` (record the value as source
    Documents with the note `From "<file>"`, not a hand-entered override), and
    `createAssetFromDocument` passes the document. Migration 016 backfills existing data: a
    first history entry for every value that has none, and Documents as the source for the
    starting values of assets created during a document's reading (asset created between the
    document's `read_started_at` and `read_at`). Values the agent filled from a document
    already had history with the file and page. Tested on the scratch database; he needs to
    run 016.
  - **More standard fields, and commentary from documents** (October 9, late;
    `db/migrations/017_more_standard_fields.sql`). Ronnie expected an offering memorandum to
    load commentary and found none: the agent could not write list entries and there were no
    narrative fields. Both were built.
    - Fields: 22 new standard fields (54 standard fields now, plus the list columns), each with a
      Description and Agent Instructions. New standard sections: **Investment Summary** (asset,
      Overview: Investment Highlights, Business Plan), **Property Summary** (property, Overview:
      Property Description, Location Description, Tenancy Summary; the agent is told 100 words
      or fewer) and **Underwriting** (property, Financials: In-Place Net Operating Income,
      Vacancy Assumption, Capital Reserve per Square Foot). Property Details gained County,
      Zoning, Parking Ratio (text, as stated), Surface and Garage Parking Spaces, Number of
      Tenants, Percent Leased, Weighted Average Lease Term (years). Building Details gained
      Construction Type, Roof, HVAC, Elevators, Typical Floor Plate, Ceiling Height (text).
    - His organization had already added several of these from the agent's proposals. The
      migration moves such a field's values, history and permissions onto the new standard
      field and deletes the organization's copy, when the key is the standard key or a listed
      other name (for example `weightedAverageLeaseTermRemaining`, `capitalReservePerSf`,
      `generalVacancyAssumption`, `averageFloorPlate`), the kind of value matches, and the
      organization has no values in the standard field yet. A same-key field of a different
      kind is renamed "(Custom)". The whole file is one transaction. Anything it did not match
      stays an organization field under Other Fields (Available Vacant SF, Static Vacant SF,
      Covered Parking Ratio are expected to stay); he can retire leftovers by hand.
    - Long text: no new field type. A text value over 90 characters shows as a full-width
      paragraph cut after four lines (`.field-card-long`), and text fields are edited in a box
      that grows; Enter saves a short one-line value, Ctrl+Enter saves a paragraph. Text is
      still limited to 2,000 characters.
    - List entries from documents: the reading's answer format gained `list_rows` (record, list,
      page, cells). The agent is shown every list on assets, properties and buildings whose
      section the person may edit (`extractableLists`), with its columns, and may add up to 25
      entries (comments of 60 words or fewer; a critical date per dated event).
      `interpretAnswer` drops a cell that does not fit its column, and an entry with nothing of
      substance or with no value in the column its list is ordered by unless that column fills
      itself in (so a critical date needs a date; a comment's date defaults to today and Made
      By to the document's name). `addDocumentRows` in `lib/lists.ts` writes the entries with
      source Documents, the document and the page, and a first history entry per cell; it runs
      in the same step as `applyReading` behind a savepoint, so a failure there never fails the
      reading, and it does nothing if the document's entries were already added.
    - The review page has **Added to Lists** (`listDocumentRows`: entries whose stored source
      value carries the document, not since removed) with Remove (`EntryRemoveButton`, the
      asset page's `removeRow`). The analyst is told how many entries were added.
    - The standard "Reading an Offering Memorandum" skill gained a "Commentary and Critical
      Dates" part (appended by 017 once). An organization that modified that skill does not
      get it, but the general rule in the prompt covers the basics without any skill.
    - The answer limit went from 16,000 to 20,000 tokens. Readings are longer now, so the
      270-second limit is closer; if he reports "took too long", lower `MAX_LIST_ROWS` or move
      the call to streaming.
    - Checked: 017 twice as a role without BYPASSRLS, with a stand-in organization holding
      matching, differently typed and duplicate fields; and the new fields, the prompt, the
      checking of entries, storage, history, the review list, editing, removal and asset
      deletion through the real code on the scratch database (scripted Claude answer). The
      long-text block and box were clicked through in Chromium. The review page section was
      not opened in a browser, and nothing was run against the real Claude API, so how good
      the comments are shows on his first memorandum.
  - **One address per property and building, and addresses from documents** (October 9, late;
    no migration; Ronnie's request).
    - `insertAddress` in `lib/records.ts` deletes whatever address a property or building had
      before saving the new one (units are unchanged and may have several). There is no
      database constraint, because older data may hold several; the app is the rule. The asset
      page shows **Change Address** instead of "+ Add Address" once there is one
      (`AddAddressForm` `replacing`), with "Replace With This Address" and a line saying the
      current one is replaced. A record still holding several from before shows them all with
      Remove and a note; saving one clears the rest.
    - The reading's answer format gained `addresses` (record, street, city, state, postal code,
      page): the property's street address, and a building's only when the document gives it a
      different one. `addAddresses` in `lib/documentReading.ts` runs after the reading is saved,
      in its own step (a failure never fails the reading): each address is looked up with the
      Census service (6 second limit, no transaction open) and saved with its coordinates and
      the service's tidy spelling, or as the document wrote it, without a location, when the
      lookup doesn't know it. A street address already on the record is **kept**; only a missing
      one, or the city-only address a new asset starts with, is filled in. A building address
      with the same street as its property is skipped (it would be a second pin on the same
      spot). The analyst is told how many were set. The review page does not list them.
    - Checked on the scratch database with a stand-in lookup: the answer checks, replacement of
      the city-only address, keeping an existing one, the building rules, lookup failure,
      organization isolation, and replacement by hand including old extras. The changed form
      was not opened in a browser; the agent's addresses were not run against the real Claude API.
  - **Floors and Units are off the asset page** (October 9, late; Ronnie's request). The
    "Floors and Units" block under each building was removed from `page.tsx`; he will bring
    them back somewhere else when rent rolls are built. Nothing else changed: the tables,
    `insertChild`, `AddChildForm` (still handles floor and unit) and any floors and units
    already entered are all kept, just not shown.
  - **Stage 5, first part: values the agent takes or calculates from a document** (October 9,
    late; `db/migrations/018_calculated_values.sql`). Ronnie's rules: the trigger is an event
    such as a rent roll upload; a skill says which values to calculate; the recipe is in the
    field's Agent Instructions; and **a figure the document itself shows is always taken as
    shown**, because users reject a number that differs from the page. Calculation is for what
    a source leaves out (later, lease data from MRI and Yardi, which carry no KPIs).
    - The trigger today is a document being read (chat or Documents tab). There is no
      Recalculate button and nothing calculates from stored data yet.
    - Each value in the reading's answer has `basis`: `stated` or `calculated`. The prompt lets
      the agent calculate only when the document does not show the value, a fitting skill
      lists the field under values to calculate, the field's instructions have a
      "How to Calculate" part, and every input is in the document; the working goes in `quote`.
      Code also enforces: no "How to Calculate" on the field means the value is dropped
      (`hasRecipe`), and a calculated value is never high confidence. Any field can be
      calculated this way, not only those flagged `calculated`.
    - Fields flagged `calculated` are now offered to the agent (`extractableFields`), so a cap
      rate printed in a memorandum is filled in as Documents. They still can't be typed by
      hand. They show their value when they have one and "Not calculated yet" otherwise.
    - A calculated value is stored with source **Calculated** (golden record, history and
      `field_source_values`, with the document and page); its history note is
      `Calculated from "<file>", page N: <working>`. The field's usual rules (when empty, when
      different) still decide filled / replaced / needs a decision. `document_findings.basis`
      (018, read through `to_jsonb`, written only when the column exists) puts a "Calculated"
      chip and the working on the review page.
    - 018 appends "How to Calculate" to ten standard fields (Occupancy Rate, Percent Leased,
      Number of Tenants, Weighted Average Lease Term, Average Rent per Square Foot, Total
      Rentable Square Feet, Net Operating Income, Going-In Cap Rate, Debt Service Coverage
      Ratio, Loan to Value) and adds two standard skills: **Reading a Rent Roll** (lists six
      values to calculate, plus a critical date per lease expiring within 24 months) and
      **Reading an Operating Statement** (monthly revenue, expenses and NOI as shown; NOI
      calculated only when missing). An organization that edited a field's instructions does
      not receive the recipe for it.
    - Not built: storing the rent roll itself (tenants, leases), calculating from stored data,
      roll-ups such as a property's square feet from its buildings, a Recalculate button, and
      "a KPI built from a hidden field is hidden" (the agent is only offered fields the person
      may edit, but a recipe's inputs are whatever the document shows).
    - Checked: 018 twice as a role without BYPASSRLS, and offering, the prompt, the checks on
      the answer, storage as Calculated, history, the review list and accepting in review on
      the scratch database with a scripted answer. Not run against the real Claude API, so
      the agent's arithmetic on a real rent roll is untested; the review page chip was not
      opened in a browser.
  - **Stage 6, first part: rent rolls, and Excel files** (October 9, late;
    `db/migrations/019_rent_rolls.sql`). Ronnie's decisions: focus on rent rolls; they come as
    PDF and Excel; each one loaded is a **dated snapshot** (a later one never changes an
    earlier one). Built against his Knoll Trail Crossing rent roll (an Argus export: suite,
    tenant, leased SF, lease start and end as month-year, base rent per SF, annual and monthly
    rent, rent escalations, recovery type; vacant rows marked "*Available" and "(STATIC)";
    totals of leased, available, static and total SF; **no as of date anywhere**).
    - Tables: `rent_rolls` (asset, property, document, `as_of_date`, `as_of_stated`, the
      document's own totals) and `rent_roll_rows` (suite, tenant, status leased / vacant /
      other, square feet, lease dates, rent per SF, annual and monthly rent, recovery type,
      note, `steps` as JSON, page). Deleting the asset deletes them (cascade); removing the
      document keeps the snapshot. `lib/rentRolls.ts` holds all reads and writes and
      `summarize` (plain sums, browser-safe). The floors and units tables are not used.
    - Reading: the answer format gained `rent_roll` (property, as of date, the document's
      totals, rows with steps; up to 250 rows, 12 steps a row). The agent copies the table as
      shown and never works out a cell; month-year dates become the first day (start, step) or
      last day (end). `interpretRentRoll` drops empty lines and leaves a bad cell empty. A
      memorandum that contains a rent roll table gets a snapshot too. `addRentRoll` in
      `lib/documentReading.ts` saves it in the same step as the reading, behind a savepoint
      (so it is skipped quietly before 019 is run). No date in the document: the day it is
      loaded is used and the snapshot is marked as assumed. Reading the same document again
      replaces its snapshot. The answer limit is now 28,000 tokens.
    - Screen: a **Rent Roll** tab on the asset (key `_rentroll`, before Map;
      `RentRollPanel.tsx`): snapshot picker (`?rentRoll=<id>`, latest date first), Change Date,
      **Delete Rent Roll** (a button with an "are you sure" pop-up and a ticked-by-default box
      to delete the document it came from too, so the file can be loaded again; the first
      version was a small red "Remove Rent Roll" link, and Ronnie reported he had no way to
      delete one), tiles added up from the rows (total, leased with percent, vacant, not
      for lease, tenants, annual base rent), a warning when the document's own total differs
      from the rows, and the rows in `DataGrid`. The review page links to the snapshot, and the
      analyst's reply has an Open Rent Roll button. The tab is shown only to people with
      `access.canAddRecords`, like a document's file, because rents and tenants are not
      covered by field permissions. Rows can't be edited or added by hand yet.
    - **The tiles show the document's own totals** (October 9, after his first real reading;
      his rule again: what the page says wins). His rent roll read correctly, 48 rows and a
      matching total, but the agent marked the amenity lounge, management office, janitor,
      maintenance and vending rows (3,503 SF, lease dates but no rent) as Not for Lease, while
      the document counts them in its 67,602 leased SF. Now: total, leased (with percent) and
      vacant square feet in the tiles are the document's figures whenever it states them, and
      Not for Lease is the remainder; tenants and rent are still added up from the rows.
      A remaining difference between the rows and the document's total shows as a quiet note.
      Tenants counts the names on leased rows; the document states no count.
    - **The rent roll rules live in the skill** (October 9, `db/migrations/020_rent_roll_skill.sql`;
      Ronnie: "this should all be listed in the load rent roll skill so it can be modified").
      The standard **Reading a Rent Roll** skill now holds: how rows are copied; Leased, Vacant
      or Not for Lease (a row with lease dates but no rent, such as a management office or
      amenity space, is Leased unless the document's totals say otherwise; Not for Lease only
      for space the document sets apart, such as static); how month-year dates are read; the
      as of date; and the check of the rows against the document's totals. Its Use When also
      covers a memorandum that contains a rent roll table. The prompt keeps only the answer
      format and a short set of defaults used when no skill covers rent rolls, and code no
      longer changes how a row is marked (a short-lived `reconcileStatuses` was removed the
      same hour, so the skill is the one place the rule lives). 020 rewrites the standard
      skill only while it lacks these parts; an organization's edited copy is not touched.
      What a skill cannot change: the answer format, the tiles showing the document's totals,
      and how Tenants is counted. His first snapshot was read before this, so its amenity-type
      rows still say Not for Lease until the rent roll is loaded again.
    - **Mixed use: the rent roll with the most rows is the main one** (October 9, Ronnie's rule
      for a building with two rent rolls, say retail and residential). No migration. Two rent
      rolls for the same property and the same date (no date means the day loaded) are both
      kept as snapshots. `rivalRentRolls` in `lib/rentRolls.ts` finds the others when one is
      read, and `applyReading` takes them as `rivals`: where both give a value for the same
      field, the one with more rows wins whichever was loaded first (the smaller one's value
      is listed as Different but Kept and not stored as a source value; a larger one arriving
      second replaces without asking). A tie favors the one already there. A field only one of
      them mentions is filled as usual, and a rent roll for another date follows the field's
      normal rules. The tab lists the larger first for a date. The two are **not added
      together**: the property's values and the tiles are the larger rent roll's alone, there
      is no Retail / Residential label, and residential columns (unit type, bedrooms, market
      rent, deposits) are not captured. Tested on the scratch database in both loading orders.
    - **The main rent roll is the skill's call too** (October 9; Ronnie asked whether the
      mixed-use rule shouldn't be in the skills; `db/migrations/021_stack_plan.sql`). The agent
      is now told which rent rolls are already saved for the asset's properties (record, date,
      rows, document; `savedRentRolls`, "## Rent rolls already saved" in the prompt) and
      answers `rent_roll.role`: main or secondary. The rule itself ("the one with the most
      rows is the main one") is a part of the Reading a Rent Roll skill, added by 021. Code
      only applies the answer to the other rent rolls of the same property and date; when the
      agent gives no answer (or no skill covers it) the row-count rule above is the fallback.
    - **Stack Plan tab and floors** (October 9, Ronnie's request; migration 021 adds
      `rent_roll_rows.floor` and `floor_inferred`). Each rent roll row can carry a floor (1 is
      the ground floor, basements negative). The agent gives it from the document, or works
      it out by the "Floors" part of the skill (first digit of a three-digit suite, first two
      of a four-digit one, empty for JAN / MAINT / VEN); worked-out floors are marked. Rows are
      saved without floors until 021 is run (`saveRentRoll` checks for the column; reads go
      through `to_jsonb`). The Rent Roll grid gained a Floor column.
      The **Stack Plan** tab (key `_stackplan`, after Rent Roll; `StackPlan.tsx`) shows when
      the asset has a property whose type is Office, to people with `canAddRecords`. It draws
      the snapshot chosen on the Rent Roll tab: floors top down, each suite a block as wide as
      its share of the largest floor, with suite, tenant and square feet on it; Color By Lease
      End Year (one blue ramp, darkest for leases ending in the rent roll's year or earlier,
      through "four years on or later") or Status; vacant is a dashed outline, not for lease
      is hatched; a color key; click a suite for its details; rows with no floor sit in a "No
      Floor" row. Checked in Chromium with rows taken from his rent roll's text (floors from
      suite numbers); not opened inside the app. A snapshot loaded before 021 has no floors,
      so its stack plan says to load the rent roll again. There is no way to set a floor by hand.
    - **The stack plan moved onto the Rent Roll tab** (October 9, Ronnie liked it and asked for
      changes; no migration). The separate Stack Plan tab is gone. `RentRollPanel` draws
      `StackPlan` under the tiles when the snapshot's property is of type Office
      (`RentRollChoice.propertyType`). Suites run left to right in suite-number order
      (`bySuite`, natural sort), and every floor is the full width, each suite sized by its
      share of its own floor (floors are no longer scaled to the largest). Fills are the
      organization's graph colors, `--chart-1` to `--chart-5` for lease end years soonest
      first, `--chart-3` for Leased in Status mode, `--chart-6` for no end date; the lettering
      is set dark or light per fill after the colors are read in the browser (`letteringFor`).
      With a many-colored palette the "darker is sooner" reading is lost and the key carries
      it; he was told. A **Blues** palette (the original ramp plus three more blues) was added
      to `GRAPH_PRESETS` so he can pick it under Org Colors > Graph Colors; as a single-hue
      ramp it separates pie slices less well than the other palettes. Checked in Chromium with
      his rent roll's rows under two palettes; not opened inside the app.
    - **Single-color palettes, darkest to lightest** (October 9, his request): `GRAPH_PRESETS`
      has Blues, Reds, Oranges, Golds, Greens, Teals, Purples, Pinks and Greys, eight shades
      each in order from darkest to lightest (Blues was reordered; the others copy its steps
      of lightness and strength in their own hue, worked out in OKLCH). The stack plan's five
      lease-end groups now use graph colors 1, 2, 4, 6 and 8 so such a palette runs its full
      range (Leased in Status mode is color 4); no end date is a fixed grey. The darkest and
      lightest shades were pulled in a little from the first Blues so `fitToSurface` leaves
      them alone on a dark panel and on white (it would otherwise nudge them out of order). An organization that saved the earlier Blues keeps
      those saved colors until it picks Blues again.
    - **The answer format has a size limit at Claude's end** (October 9). Right after the
      stack plan shipped, every reading failed; the analyst relayed it as "the reader's setup
      is too large". Cause: the required answer format (the JSON schema sent as
      `output_config`) had grown by three properties (floor, floor shown, role) past what
      Claude accepts. It had 72 properties and nested parts for an existing asset; 69 worked
      an hour earlier. Fixes: the rent roll row lost `note`, `page` and the nested steps list
      (steps are now one text cell, `date|rent per SF|annual rent; ...`, parsed in
      `interpretRentRoll`), and a worked-out floor is written `~5` instead of a second
      property, which brings it to 65 (69 when creating an asset). And `askClaudeWith` in
      `lib/claude.ts` now retries once when Claude answers 400 about the format itself: the
      same question with the schema described in the text instead of required, and the JSON
      picked out of the reply. **Before adding anything to the answer format, count it**
      (properties plus nested objects and lists) and keep it under about 69; fold a new
      detail into an existing text cell where possible.
    - KPIs from a rent roll still come from the reading itself (stage 5: as shown, or
      calculated by the Reading a Rent Roll skill). Nothing recalculates from the stored rows
      yet, and two snapshots can't be compared side by side.
    - **Excel**: `.xlsx` and `.xlsm` can be uploaded anywhere a PDF can (`documentKind`,
      `DocumentRecord.kind`; the file must start like a zip). `lib/spreadsheet.ts` reads the
      workbook with Node's zlib, no library added: every sheet as text, rows as tab-separated
      cells, dates and percentages as a person sees them, values not formulas (a file saved by
      a tool that never calculated its formulas shows those cells empty). The agent gets that
      text instead of a PDF; "page" means sheet number. Old `.xls` is refused with a message to
      save as .xlsx. No photos are taken from a workbook. Limits: 300,000 characters, 5,000
      rows a sheet, 20 sheets.
    - Checked: 019 twice as a role without BYPASSRLS; the workbook reader on a workbook made
      with openpyxl; upload checks, the reading with a scripted answer through
      `readIntoAsset`, snapshots, dates, replacement, isolation and deletion on the scratch
      database; the real panel clicked through in Chromium with stand-in rows. **Not run
      against the real Claude API**: whether the agent copies all of his 60-odd rows correctly
      and in time, and whether the larger answer format is accepted, shows on his first try.
      A real Excel file from Excel itself was not tried.
  - Not built yet (later stages): stored formulas
    (calculated fields with no value show "Not calculated yet"), tenants, leases, rent roll, cash flow, feeds and
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
