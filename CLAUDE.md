# Handoff notes for Claude

Read this first in any new conversation about Stratios. README.md covers setup, how organizations
work and how data is isolated; this file covers how we work and where things stand.

## About the owner

- Ronnie is non-technical and on Windows. He prefers that Claude does the work end to end rather
  than handing him commands. Explain things in plain words and skip the jargon.
- Use US spelling in the UI ("Color", "Organize").
- Headers, nav items and panel titles use Title Case ("Brand Colors", "Add an Asset"); sentences,
  and helper text stay in sentence case. Buttons and menu items are Title Case too ("Add Asset").
- Fonts: Satoshi for headings, buttons and the logo text (loaded from Fontshare with a `<link>` in
  `app/layout.tsx`, named as `--font-display` in `globals.css`); IBM Plex Sans for body text.
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
3. npm can't reach the registry from the cloud workspace, so code there can't be built or run;
   say so and ask him to check the result on localhost or dev.stratios.app.

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
- Assets list per organization (`app/dashboard/page.tsx`, `lib/assets.ts`) with row-level security.
- Members page (admins): invite by email, roles.
- Admin Settings (`app/dashboard/settings/`):
  - Site Colors: 10 roles, Dark/Light toggle, hex editing, 16 presets (`lib/presets.ts`),
    "Generated Brand Colors" (persisted, not re-fetched), "Stratios". Unsaved changes are preview
    only and revert on leaving the page. "Reset Colors" (beside Save in both editors) puts back the
    last saved colors; it is disabled when nothing has changed.
  - Graph Colors: 8 slots, pie and bar previews side by side, "Other Themes" chips including
    Generated Brand Colors and 31 presets. Palettes were checked for contrast and color-blind
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
