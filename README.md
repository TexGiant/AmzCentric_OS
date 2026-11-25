# AmzCentric OS

Internal Amazon advertising analytics for AmzCentric. One login for the team, one workspace per client brand, with data pulled from the Amazon Ads API (daily reports) and Amazon Marketing Stream (hourly, through SQS) automatically.

- **Overview**: Today (live) / Yesterday / 7 / 14 / 30-day cards, a sales vs. spend trend with logged actions marked on it, and an "Attention required" list
- **Reports**: the team's reporting sheet by day, week (any start day) or month, with a totals row, chart, CSV export and custom ranges. Total orders / total sales and the ratios built on them (organic orders, organic & PPC ratio, TACOS) are tagged SP-API and stay empty until Seller Central is connected (`daily_analytics.total_orders` / `total_sales`, migration 0006)
- **What Changed**: this week vs. last, with every campaign and ASIN mover tagged with its driver (traffic, conversion, order value, paused) and any logged action
- **Every table**: a totals row (counts and money added up; ACOS, CVR, CTR and CPC blended, e.g. total spend ÷ total sales; Δ columns vs the prior period), a Filters panel (min/max on any number column, pick-lists for Type, State, Match, Driver…) with removable chips, a Columns picker (remembered per table), and CSV export of exactly what's filtered and shown
- **Campaigns / Search Terms / Products**: sortable, searchable, CSV export, 7–90 day presets or any custom from–to range (compared with the same number of days before it). Search terms have Wasted spend, Winners and Harvest views
- **Hourly**: Marketing Stream spend and sales by hour against the 7-day average (for dayparting)
- **Action Log**: record bids, budgets, negatives and listing changes. Each one is measured over 14 days before vs. after
- **Goals**: monthly sales / spend / ACOS targets, pacing and month-end projection
- **Meetings**: paste weekly client-call notes (or save them from Claude, or have a recorder push them). Claude writes a summary, insights tied to the brand's numbers, next week's agenda and tasks, and closes open tasks the call says are done
- **Tasks**: per-brand task list with owners, due dates and priorities, plus **My Tasks** across every brand
- **Settings** (admins): Amazon OAuth connections (NA/EU/FE), brands, data sync (backfill and job queue), team roles and brand assignments, audit log
- **Role-based access**: Admin, Brand manager, PPC manager and Catalog manager roles; everyone except admins sees only the brands assigned to them (see *Roles & access*)

The app runs on **demo data** until Supabase is configured, so you can click through everything first: `npm install && npm run dev`.

---

## Stack

| Component | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) | `src/` dir, auth proxy at `src/proxy.ts` |
| UI | React 19, Tailwind CSS 4, Recharts, Lucide | AmzCentric CSS v1.0 tokens in `src/app/globals.css`; components in `src/components/ui.tsx`; Manrope + Montserrat |
| DB + Auth | Supabase | Schema: `supabase/migrations/0001_init.sql` |
| Hosting | Vercel | Crons in `vercel.json` |
| DNS | GoDaddy | Subdomain CNAME to Vercel (your Hostinger site is untouched) |
| Hourly data | Amazon Marketing Stream → SQS | `src/lib/stream/sqs.ts` |

## How data flows

```
Amazon Ads API ──(11:00 + 19:00 UTC cron: request last 7 days)──► report_jobs (pending)
               ◄─(every 30 min: poll, download gzip JSON)─┘
                     │
                     ▼
     campaign_daily · search_term_daily · product_daily · campaigns
                     │  refresh_daily_analytics()
                     ▼
               daily_analytics ──► dashboards (via SQL functions, RLS on)

Marketing Stream ──SNS──► SQS ──(every 10 min)──► stream_traffic / stream_conversion ──► Hourly + "Today"
```

- The daily cron re-requests a **trailing 7-day window** (`REQUEST_LOOKBACK_DAYS`) so late-attributed sales are restated.
- Backfills are cut into **31-day chunks** and capped at Amazon's retention (95 days; SB 60).
- Stream records are deltas. Each one is stored once, keyed on `idempotency_id`, and summed per hour in the profile's timezone. Stream rows are matched to brands through `campaign_id`, so **run a backfill first** to populate the `campaigns` table.
- Refresh tokens are encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) and never readable by logged-in users. Only the server's service role can read them.

### Routes

| Path | Auth | Purpose |
|---|---|---|
| `/dashboard`, `/dashboard/[brand]/…` | session | All-brands overview + brand pages |
| `/settings/team` · `brands` · `connections` · `sync` · `meetings` · `audit` | session, Admin role | Admin |
| `/settings/claude` | session | Connect your own Claude (admins see everyone's connections) |
| `/api/amazon/authorize` → `/api/amazon/callback` | session | Login with Amazon, encrypts token, imports profiles |
| `/api/backfill`, `/api/poll`, `/api/stream-ingest` | session | Manual triggers (Data Sync page) |
| `/api/cron/request-daily` · `poll-reports` · `stream-ingest` | `CRON_SECRET` bearer | Vercel Cron |
| `/auth/callback`, `/auth/confirm`, `/account/set-password` | public | Login links and invites |
| `/api/meetings/ingest` | `MEETINGS_INGEST_TOKEN` bearer | Recorder / Zapier pushes meeting notes |
| `/me`, `/hr`, `/settings/hr` | session (`/hr` + Settings → HR: Admin) | My day, team attendance & leave, HR settings |
| `/api/hr/heartbeat` | session | Active minutes in the app (sent by the browser) |
| `/api/hr/bot/requests` · `requests/{id}` · `day` · `month` | `HR_API_TOKEN` bearer | HR bot: read, approve within policy, escalate |
| `/api/hr/punches` | `ATTENDANCE_TOKEN` bearer | Fingerprint machine bridge |

---

## Setup

### 1. Supabase

1. Create a project and copy its URL, anon key and service-role key into the env vars (step 5).
2. **SQL Editor** → paste and run `supabase/migrations/0001_init.sql`, then each later file in `supabase/migrations/` in number order (`0002_…`, …).
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". This makes the app invite-only.
4. **Authentication → URL Configuration**: Site URL `https://os.amzcentric.com`. Add `https://os.amzcentric.com/**` to Redirect URLs (plus `http://localhost:3000/**` for local dev).
5. **Authentication → Email Templates**: paste the branded templates from `supabase/email-templates/`. Use `invite.html` for **Invite user** (subject "You're invited to AmzCentric OS") and `recovery.html` for **Reset password** (subject "Reset your AmzCentric OS password"). Their links open `/auth/confirm`, which only uses the one-time link when the person presses the button, so email scanners can't spend it. In **SMTP settings**, set the sender name to "AmzCentric OS".
   - Password resets are admin-only: Settings → Team → open a person → **Send password reset**. Reset links an admin didn't start are refused. Admins can also **Resend invite** for anyone who hasn't accepted yet.
6. **Authentication → Users → Add user**: create *your* account with an email listed in `ADMIN_EMAILS`. Invite everyone else from the Team page.

### 2. Amazon Ads API

In your Login with Amazon security profile (the one tied to your Ads API access):

- **Allowed Return URLs**: add `https://os.amzcentric.com/api/amazon/callback` (and `http://localhost:3000/api/amazon/callback` for local).
- Copy the **Client ID** / **Client Secret** to `AMAZON_ADS_CLIENT_ID` / `AMAZON_ADS_CLIENT_SECRET`.

### 3. Marketing Stream (SQS)

**Shortcut:** in AWS CloudShell (N. Virginia), run `bash scripts/aws/setup-stream-queues.sh <STREAM_AWS_ACCESS_KEY_ID>`. It creates any missing `sp-/sb-/sd-` traffic and conversion queues with Amazon's required access policy, grants the app's IAM user read access, and prints the `STREAM_SQS_QUEUE_URLS` value. The manual steps below do the same thing.

You already receive Stream data into SQS. The app needs to read from those queues:

1. In AWS IAM, create a user (or access key) with this policy on your Stream queue(s):
   ```json
   { "Effect": "Allow",
     "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
     "Resource": ["arn:aws:sqs:us-east-1:<account>:<sp-traffic-queue>", "arn:aws:sqs:us-east-1:<account>:<sp-conversion-queue>"] }
   ```
2. Set `STREAM_SQS_QUEUE_URLS` (comma-separated), `STREAM_AWS_ACCESS_KEY_ID`, `STREAM_AWS_SECRET_ACCESS_KEY`. The region comes from the queue URL.
3. The app handles both raw and SNS-wrapped messages and auto-confirms SNS subscription messages. `sp-traffic`, `sp-conversion` and the SB/SD equivalents are stored; other datasets are skipped.

4. **Subscribe each profile.** Marketing Stream only sends data for profiles that have their own subscription, per dataset. Queues for `sb-traffic`, `sb-conversion`, `sd-traffic` and `sd-conversion` are optional but needed for Sponsored Brands / Display hourly data. Go to **Settings → Connections → Marketing Stream** and click **Subscribe** on any profile that shows *Not subscribed*. The app creates the `sp-traffic` and `sp-conversion` subscriptions through the Ads API and confirms them automatically. Queue names must contain the dataset name (e.g. `.../sp-traffic`, `.../sp-conversion`) so the app knows which queue gets which dataset.

> **Important:** if anything else (a script, another tool) currently reads these queues, the two will compete for messages, because SQS delivers each message to only one reader. Either stop the other reader, or add a second SQS subscription to the Stream SNS topic just for this app.

### 4. Vercel

1. Push this repo to GitHub → Vercel **Add New Project** → import it.
2. Add every variable from `.env.example` under **Settings → Environment Variables**.
   - `TOKEN_ENCRYPTION_KEY`: run `openssl rand -hex 32`. Don't lose it, or every Amazon connection will need re-authorizing.
   - `CRON_SECRET`: any long random string. Vercel sends it to the cron routes automatically.
3. Deploy. **The cron schedules need the Pro plan.** Hobby only allows once-a-day crons, so on Hobby change `poll-reports` and `stream-ingest` in `vercel.json` to daily, or call those URLs from an external scheduler with the bearer header.

### 5. Domain: GoDaddy → Vercel (keep Hostinger for your main site)

1. Vercel → Project → **Settings → Domains** → add `os.amzcentric.com`.
2. GoDaddy → **DNS → Add record**: Type `CNAME`, Name `os`, Value = the target Vercel shows you (e.g. `cname.vercel-dns.com`), TTL 1 hour.
3. Don't change nameservers. Your root domain and Hostinger site keep working; only the `os.` subdomain points to Vercel.

### 6. First run

1. Sign in → **Settings → Brands**: add your clients.
2. **Settings → Connections** → *Connect NA* (and EU/FE if needed) → approve with the Amazon login that has your advertising accounts.
3. Enable the profiles you manage and assign each one to a brand.
4. **Settings → Data Sync** → request a 60–95 day backfill → click *Check reports* after a few minutes (Amazon takes about 1–20 minutes per report). After that, the crons keep data current.

## Claude connector (MCP)

Teammates can connect Claude (claude.ai, desktop, mobile, Claude Code) to AmzCentric OS and ask about any brand, or have Claude log actions. Setup steps and active connections: **Settings → Claude connector**.

- Endpoint: `https://<your domain>/api/mcp` (MCP Streamable HTTP, stateless). `NEXT_PUBLIC_SITE_URL` must be the exact domain people use.
- Sign-in: built-in OAuth 2.1 server, dynamic client registration, authorization code + PKCE (S256), refresh-token rotation with reuse detection. Each person approves with their own AmzCentric OS login; the same domain/team rules apply. Tokens are stored hashed (`supabase/migrations/0003_claude_connector_oauth.sql`).
- Allowed redirect URIs: `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, `http://localhost:*` (Claude Code / MCP Inspector), plus any in `OAUTH_EXTRA_REDIRECT_URIS`.
- Access: every tool applies the signed-in teammate's roles and brands. Tools their roles don't grant aren't registered for them, `list_brands` returns only their brands, and other brands look like they don't exist. `my_access` tells Claude what the person can see. Every call is in the audit log.
- Tools (`src/lib/mcp/server.ts`, `meeting-tools.ts`): `my_access`, `list_brands`, `get_brand_overview`, `get_what_changed`, `get_campaigns`, `get_search_terms`, `get_products`, `get_hourly`, `get_action_log`, `get_goals`, `get_report`, `list_meetings`, `get_meeting`, `list_tasks` (read-only); `log_action`, `save_meeting_notes`, `create_task`, `update_task` (write to the app as the signed-in user). Nothing can change Amazon.

## Roles & access

Run `supabase/migrations/0007_roles_and_access.sql` once (after 0001–0006). It's safe to re-run.

On its first run, existing admins stay Admin. Everyone else gets Brand manager + PPC manager + Catalog manager on every existing brand, so nobody is locked out. Narrow it down afterwards in **Settings → Team**. Re-running it never re-grants access you removed. New people start with no roles and no brands (default deny).

| Area | Admin | Brand manager | PPC manager | Catalog manager |
|---|:-:|:-:|:-:|:-:|
| Brands visible | all | assigned | assigned | assigned |
| Overview, Reports, Products | ✓ | ✓ | ✓ | ✓ |
| What Changed | ✓ | ✓ | | |
| Goals | edit | edit | | |
| Campaigns, Search Terms, Hourly | ✓ | ✓ | ✓ | |
| Action Log | log any | log any | log any | log listing / price & coupon |
| Meetings | create | create | read | read |
| Tasks | all | all on their brands, assign to their team | own + assigned | own + assigned |
| My Tasks, Claude connector (own) | ✓ | ✓ | ✓ | ✓ |
| My Day: check in, request leave, own attendance & app time | ✓ | ✓ | ✓ | ✓ |
| HR page (everyone's attendance, leave decisions, app time), Settings → HR | ✓ | | | |
| Settings, Audit log, future Leads / Audits / Sales / Marketing | ✓ | | | |

- A person can hold several roles; they get the combined permissions on their assigned brands.
- **Brand managers' teams:** set "Reports to" on a person in Settings → Team. A brand manager sees every task on their brands and can assign tasks to themselves and their direct reports. A task can only go to someone who can see that brand.
- Defined but granted to nobody yet: `catalog_inventory` (SP-API inventory), `campaign_edit`. A `junior` level is stored per role for a future approval flow (`requiresApproval()` in `src/lib/rbac.ts`), not enforced yet.

**Enforced in three layers:**
1. **Menu:** the sidebar and brand picker show only permitted pages and brands.
2. **Server:** brand pages and settings are checked in their layouts before anything streams, so a typed URL to a forbidden brand or page is a real 404, and every page checks again itself. Server actions, API routes and CSV exports check permission and brand. The data layer (`src/lib/data/scoped.ts`) refuses other brands.
3. **Database:** RLS policies replace `team_read`. They allow rows only for the caller's brands (`my_brands()` / `my_profiles()`), and goals and tasks also check roles. Raw Marketing Stream rows are admin-only and read through brand-checked functions. Writes go through the server.

The rules live in one place, `src/lib/rbac.ts`. The sidebar, the server guards and the Claude connector all use it.

**Audit log** (Settings → Audit log, admins) records sign-ins (and failures), access denials, role and brand changes, CSV exports, Claude connector calls, and every write: actions, goals, meetings, tasks, brands, profiles, syncs. Each entry has who, what, when, which brand and how (app, connector, webhook).

**Demo mode** has a dev-only "View as" switcher at the bottom of the sidebar. It switches between sample users of each role, including a new hire with no roles. It isn't available when connected to Supabase.

## Meetings & tasks

Run `supabase/migrations/0005_meetings_tasks.sql` once. Notes reach a brand's **Meetings** tab three ways:

1. **Paste** them on the Meetings tab.
2. **From Claude** via the connector: *"Save this meeting to AmzCentric OS for Mr. Assist and create the tasks."* Claude sends the notes plus the summary, insights and tasks it extracted (`save_meeting_notes`).
3. **From a recorder**: Zapier (or Make / n8n) POSTs to `/api/meetings/ingest` with `Authorization: Bearer $MEETINGS_INGEST_TOKEN` and JSON `{ title, notes | summary | transcript, date?, brand?, external_id? }`. The brand is matched from `brand` or the meeting title; `external_id` stops duplicates. Steps: **Settings → Meeting capture**.

Pasted and pushed notes are analyzed with the Claude API (`src/lib/meetings/analyze.ts`, structured output) when `ANTHROPIC_API_KEY` is set: Claude gets the notes, the brand's last 7 vs. prior 7 days, top campaigns, goal pacing, recent Action Log entries, the team's emails and the brand's open tasks. It returns a summary, insights (win / risk / opportunity / decision / client request), tasks with owners and due dates, open tasks the call says are done, and next week's agenda. The analysis runs after the response (`after()`), and the meeting page refreshes itself until it's done. Without the key, notes are still saved and tasks can be added by hand or from Claude.

## Case study feed

`GET /api/insights/case-studies` (bearer `INSIGHTS_API_TOKEN`) returns measured Action Log wins, anonymized, for the case study bot (`docs/bots/case-study-bot.md`).
- Only brands an admin marks **Allowed** in Settings → Brands are included (migration 0008 adds `brands.category` and `case_study_consent`, default "not allowed").
- Names, campaigns, ASINs and SKUs are stripped, and dates become months.
- Every call is in the audit log.
- Rules and tests: `src/lib/case-study-rules.ts`, `tests/case-study-rules.test.mjs` (`npm test`).

## HR: attendance, leave and app time

Run `supabase/migrations/0009_hr.sql` once (after 0008). Until then the HR pages say so and nothing else changes.

- **My Day** (`/me`, everyone): check in, request leave or WFH, leave balances, own attendance and app time. A check-in prompt shows at the top of every page until the person checks in, punches the fingerprint machine, or is off. Checking in as WFH without a request files one automatically.
- **HR** (`/hr`, admins): the day board (office / WFH / leave / late / absent, first in and last out, app time, anything odd), leave requests waiting for you or for HR, the month summary, balances, and time in the app per person and per brand.
- **Settings → HR**: leave policy (defaults: 8 sick, 6 casual, 12 annual, 2 half days a year, 2 WFH days a month; notice 0 / 1 / 3 days), office hours and timezone (Asia/Karachi), working days, holidays, and per person: name, fingerprint machine ID, tracked or not (admins off by default), and leave already taken this year before the app.
- **Fingerprint machine (ZKTeco K50):** `tools/attendance-bridge` runs on an office PC every 5 minutes and sends new punches to `/api/hr/punches` (bearer `ATTENDANCE_TOKEN`). Without it, upload the machine's USB export (`attlog.dat`) in Settings → HR.
- **App time:** while the app is open and the person used the mouse or keyboard in the last 5 minutes, the browser sends one heartbeat a minute. Each counts one minute, split by the brand page they're on. Several tabs don't double-count. Work outside the app isn't counted; there are no screenshots or keystroke logs.
- **HR bot** (`docs/bots/hr-bot.md`, bearer `HR_API_TOKEN`): reads waiting requests with a policy check, approves those within policy, escalates the rest to Zain with a reason, and reads the day board and month summary for reports. It can't decline or change settings. Admins decide escalated requests on the HR page.
- Rules and tests: `src/lib/hr/policy.ts`, `tests/hr-policy.test.mjs`, `tests/hr-api.test.mjs`.

## Brand & design system

The UI follows **AmzCentric CSS v1.0**: white pages, navy `#000F22` ink, amber `#F8A42E` as the one action color, Montserrat for headings and figures, Manrope for everything else.

- Tokens: `src/app/globals.css` (`navy-*`, `gold-*`, semantic `ink`, `muted`, `line`, `brand`, status colors, shadows, `--hero-gradient`)
- Components: `src/components/ui.tsx` mirrors the `.amz-*` classes: `Card`, `CardHeader`, `Kpi` (stat with amber bar), `Eyebrow` (`[ LABEL ]`), `Pill` (badge), `Delta` (▲/▼), `Segmented`, `Tabs`, `Alert`, `Progress`, `Avatar`, `IconChip`, `NavyPanel`, `buttonClass.*`, `inputClass` / `selectClass`
- Logo: `public/brand/amzcentric-logo.png` (light surfaces). Favicon and Apple icon are cut from the "A" mark (`src/app/icon.png`, `src/app/apple-icon.png`)
- Charts: navy = sales, amber = spend, amber dashed lines = logged actions

## Environment variables

See `.env.example`. With `NEXT_PUBLIC_SUPABASE_URL` empty (or `DEMO_MODE=true`) the app runs on generated demo data and skips auth.

## Development

```bash
npm install
npm run dev        # http://localhost:3000 (demo data until .env.local has Supabase keys)
npm run typecheck  # tsc --noEmit
npm run build
```

## Roadmap

- **SP-API** (in approval): Sales & Traffic report into `daily_analytics.total_sales/sessions` (enables real TACOS and total-sales goals), FBA/AWD inventory with days of cover, Search Query Performance
- Weekly client report built from the numbers, the action log and the week's meeting (print/PDF)
- Google SSO for `@amzcentric.com`
- Budget-usage Stream dataset into an "out of budget" alert
