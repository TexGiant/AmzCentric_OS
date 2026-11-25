# CLAUDE.md — working on AmzCentric OS

## How we work
Zain (owner) asks Claude Code directly, in a session. Claude builds it, tests it, ships it, and tells Zain exactly what he has to do (migrations to run, env vars to set, settings to change). There is no separate planning, review or release bot.

- `main` is protected: changes land through a pull request. Claude opens it once the checks below pass and tells Zain what to check; **Zain clicks Merge**, and Vercel deploys `main` automatically. Claude doesn't merge or push to `main`.
- Commit messages explain the why. No model names in commits, code comments or PRs.
- Before merging, tell Zain anything that will break until he acts (e.g. a page that needs a migration). Make code degrade gracefully until then.

## Project
- App: AmzCentric OS — the AmzCentric team's internal workspace for client brands' Amazon Ads: dashboards, reports, action log, goals, meetings and tasks, a case study feed, HR (attendance, leave, app time), plus a Claude connector.
- Stack: Next.js 16 (App Router; `src/proxy.ts` replaces middleware), React 19, TypeScript (strict), Tailwind 4, Supabase (Postgres, Auth), deployed on Vercel. Data from the Amazon Ads API (daily reports) and Amazon Marketing Stream (SQS).
- Live: https://os.amzcentric.com
- Supabase: Claude never connects to the production project. Test database changes on a local Postgres (with a stub of Supabase's `auth` schema and roles) and app changes in demo mode.
- Read `AGENTS.md` first: this Next.js version has breaking changes (e.g. `params`/`searchParams` are Promises, `proxy.ts` not `middleware.ts`).

## Commands
- Install: `npm ci`
- Dev server: `npm run dev` — with no Supabase env vars it runs in **demo mode** on generated data (force with `DEMO_MODE=true`). The sidebar's dev-only "View as" switcher signs you in as sample users of each role.
- Type check: `npm run typecheck`
- Tests: `npm test` (Node's built-in runner; `tests/*.test.mjs`; `tests/support/alias.mjs` resolves `@/` so route handlers can be tested)
- Build: `DEMO_MODE=true npm run build`
- Lint: not set up yet.

Before merging: `npm run typecheck`, `npm test` and the build pass; new behaviour has a test where practical, and a bug fix has a test that failed before the fix. Check UI changes in a browser in demo mode.

## Point these out explicitly in the PR (sensitive areas)
- Sign-in and accounts: `src/lib/auth.ts`, `src/app/auth/**`, `src/app/login/**`, `src/app/account/**`, `src/lib/oauth/**`, `src/app/api/oauth/**`, `src/lib/password-reset.ts`, `supabase/email-templates/**`
- Request security: `src/proxy.ts`, `src/lib/public-paths.ts`, the access-check layouts (`src/app/(app)/dashboard/[brand]/layout.tsx`, `src/app/(app)/settings/layout.tsx`)
- Access control: RLS policies in `supabase/migrations/`, `src/lib/rbac.ts`, `src/lib/access.ts`, `src/lib/data/scoped.ts`, `TOOL_PERMS` in `src/lib/mcp/server.ts`
- Secrets: `src/lib/crypto.ts`, `src/lib/env.ts`, `.env.example`, `vercel.json` crons
- Anything that changes what a client's data exposes outside the app (Claude connector, case study feed, exports)
- Employee data (HR): `src/lib/hr/**`, `src/app/api/hr/**`, `src/app/hr-actions.ts`, `tools/attendance-bridge/**`

## Rules
- Database changes: a new numbered file in `supabase/migrations/` that is safe to re-run; test it locally; tell Zain to run it in the Supabase SQL editor.
- Never write secrets, keys, real client data or real employee data (names, leave reasons) into code, tests, logs, commits or PRs. Use the demo brands (Harbor & Pine, Lumen Labs, Kodiak Trail, Bloomwell) in tests. The repo is public.
- Never add code that changes anything in a client's Amazon account. The app only reads from Amazon (the one exception is creating Marketing Stream subscriptions).
- Smallest change that fixes the root cause. No unrelated refactors.
- Don't hide problems: no empty catch blocks, no `@ts-ignore` / `eslint-disable` to get past checks, no skipped or weakened tests.
- Don't add dependencies unless needed; say why when you do.

## Code conventions
- TypeScript strict, no `any` (the tool-registration wrapper in `src/lib/mcp/server.ts` is the only exception).
- Components in `src/components`; server logic in `src/lib` and `src/app/api`; server actions in `src/app/*-actions.ts`.
- Supabase clients from `src/lib/supabase` (`server.ts` = signed-in user, RLS applies; `client.ts` = browser; `admin.ts` = service role, server only, after checking permissions). The only exceptions are route handlers that must set auth cookies on their own response (`src/proxy.ts`, `src/app/auth/login`, `src/app/auth/verify`).
- Access control: every page, server action, API route and export checks permission and brand with `requirePerm` / `requireAccess` / `can()` (`src/lib/access.ts`, `src/lib/rbac.ts`). A brand the person can't see returns 404.
- Every write records an entry with `audit()` (`src/lib/audit.ts`).
- Dates are `YYYY-MM-DD` strings in the marketplace timezone (`src/lib/dates.ts`, `brandClock`/`brandRange` in `src/lib/page.ts`). Money shows 2 decimals; table totals blend percentages from totals.
- API routes validate input, check auth, and return generic errors (log details server-side only).
