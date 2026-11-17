# AmzCentric OS

Internal Amazon advertising analytics for AmzCentric. One login for the team, one workspace per client brand, with data pulled from the Amazon Ads API (daily reports) and Amazon Marketing Stream (hourly, through SQS) automatically.

- **Overview**: Today (live) / Yesterday / 7 / 14 / 30-day cards, a sales vs. spend trend with logged actions marked on it, and an "Attention required" list
- **What Changed**: this week vs. last, with every campaign and ASIN mover tagged with its driver (traffic, conversion, order value, paused) and any logged action
- **Campaigns / Search Terms / Products**: sortable, searchable, CSV export. Search terms have Wasted spend, Winners and Harvest views
- **Hourly**: Marketing Stream spend and sales by hour against the 7-day average (for dayparting)
- **Action Log**: record bids, budgets, negatives and listing changes. Each one is measured over 14 days before vs. after
- **Goals**: monthly sales / spend / ACOS targets, pacing and month-end projection
- **Settings**: Amazon OAuth connections (NA/EU/FE), brands, data sync (backfill and job queue), team invites

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
Amazon Ads API ──(06:00 UTC cron: request last 7 days)──► report_jobs (pending)
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
| `/settings/connections` · `brands` · `sync` · `team` | session (team: admin) | Admin |
| `/api/amazon/authorize` → `/api/amazon/callback` | session | Login with Amazon, encrypts token, imports profiles |
| `/api/backfill`, `/api/poll`, `/api/stream-ingest` | session | Manual triggers (Data Sync page) |
| `/api/cron/request-daily` · `poll-reports` · `stream-ingest` | `CRON_SECRET` bearer | Vercel Cron |
| `/auth/callback`, `/auth/confirm`, `/account/set-password` | public | Login links and invites |

---

## Setup

### 1. Supabase

1. Create a project and copy its URL, anon key and service-role key into the env vars (step 5).
2. **SQL Editor** → paste and run `supabase/migrations/0001_init.sql`.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". This makes the app invite-only.
4. **Authentication → URL Configuration**: Site URL `https://os.amzcentric.com`. Add `https://os.amzcentric.com/**` to Redirect URLs (plus `http://localhost:3000/**` for local dev).
5. **Authentication → Email Templates → Invite user**: change the link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/account/set-password`
6. **Authentication → Users → Add user**: create *your* account with an email listed in `ADMIN_EMAILS`. Invite everyone else from the Team page.

### 2. Amazon Ads API

In your Login with Amazon security profile (the one tied to your Ads API access):

- **Allowed Return URLs**: add `https://os.amzcentric.com/api/amazon/callback` (and `http://localhost:3000/api/amazon/callback` for local).
- Copy the **Client ID** / **Client Secret** to `AMAZON_ADS_CLIENT_ID` / `AMAZON_ADS_CLIENT_SECRET`.

### 3. Marketing Stream (SQS)

You already receive Stream data into SQS. The app needs to read from those queues:

1. In AWS IAM, create a user (or access key) with this policy on your Stream queue(s):
   ```json
   { "Effect": "Allow",
     "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
     "Resource": ["arn:aws:sqs:us-east-1:<account>:<sp-traffic-queue>", "arn:aws:sqs:us-east-1:<account>:<sp-conversion-queue>"] }
   ```
2. Set `STREAM_SQS_QUEUE_URLS` (comma-separated), `STREAM_AWS_ACCESS_KEY_ID`, `STREAM_AWS_SECRET_ACCESS_KEY`. The region comes from the queue URL.
3. The app handles both raw and SNS-wrapped messages and auto-confirms SNS subscription messages. `sp-traffic`, `sp-conversion` and the SB/SD equivalents are stored; other datasets are skipped.

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
- Weekly client report built from the numbers and the action log (print/PDF)
- Google SSO for `@amzcentric.com`
- Budget-usage Stream dataset into an "out of budget" alert
