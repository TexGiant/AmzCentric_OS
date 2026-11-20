import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { impactSummary, measureActions } from "@/lib/action-impact";
import { demoSource } from "@/lib/data/demo";
import { adminSource } from "@/lib/data/supabase";
import { ACTION_CATEGORIES, type ActionCategory, type Brand, type DataSource, type DailyPoint } from "@/lib/data/types";
import { addDays, daysInMonth, eachDay, hourInTz, monthStart, todayInTz } from "@/lib/dates";
import { isDemoMode } from "@/lib/env";
import { attentionItems, salesDriver } from "@/lib/insights";
import { acos, change, cpc, ctr, cvr, roas, sum, type Totals } from "@/lib/metrics";
import type { McpUser } from "@/lib/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { registerMeetingTools } from "@/lib/mcp/meeting-tools";
import { DEFAULT_WEEK_START, WEEKDAYS, buckets, buildReport, reportWindow, type Period } from "@/lib/report";

/*
 * The AmzCentric OS MCP server: read tools over every brand's data + log_action.
 * Built per request (stateless) for the signed-in teammate.
 */

const INSTRUCTIONS = `AmzCentric OS holds Amazon Advertising data (Sponsored Products, Sponsored Brands, Sponsored Display) for the brands AmzCentric manages.
- Start with list_brands to get brand slugs. Every other tool takes a brand slug or name.
- Money is in the marketplace currency (USD for US). Percent fields end in _pct and are already multiplied by 100.
- "Today" and hourly data come from Amazon Marketing Stream, refreshed every 10 minutes and typically 1–2 hours behind the Amazon Ads console. Yesterday and earlier come from Amazon's daily reports and are exact once the report lands; if yesterday's report hasn't arrived, the overview marks it preliminary.
- Dates are in the marketplace timezone (Pacific for US). Sales use Amazon's attribution: 7-day for Sponsored Products, 14-day for Sponsored Brands and Display.
- Total sales and TACOS are not available yet (they need SP-API); sales here are ad-attributed.
- log_action writes to the team's Action Log under the signed-in user's name. Only call it for a change that was actually made (or is being made) in Amazon, one change per entry, with numbers in the description (e.g. "Raised exact bids +15% on top 5 keywords"). Confirm with the user before logging if they haven't explicitly asked you to log it.
- Meetings & tasks: after a weekly brand call, save_meeting_notes stores the notes on the brand's Meetings tab. Pass the summary, insights and tasks you extracted (call list_tasks first so you don't duplicate open tasks, and pass completed_task_ids for tasks the call says are finished). list_tasks / create_task / update_task manage the team's to-dos; owner "me" is the signed-in teammate.
- This connector cannot change anything in Amazon itself.`;

const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const p2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 100);

function metrics(t: Totals) {
  return {
    spend: r2(t.cost),
    sales: r2(t.sales),
    orders: t.orders,
    units: t.units,
    clicks: t.clicks,
    impressions: t.impressions,
    acos_pct: p2(acos(t)),
    roas: r2(roas(t)),
    cpc: r2(cpc(t)),
    ctr_pct: p2(ctr(t)),
    cvr_pct: p2(cvr(t)),
  };
}

function changes(now: Totals, prev: Totals) {
  return {
    spend_change_pct: p2(change(now.cost, prev.cost)),
    sales_change_pct: p2(change(now.sales, prev.sales)),
    acos_change_pct: p2(change(acos(now), acos(prev))),
    clicks_change_pct: p2(change(now.clicks, prev.clicks)),
    cvr_change_pct: p2(change(cvr(now), cvr(prev))),
  };
}

const ok = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

class ToolError extends Error {}

const brandArg = z.string().describe("Brand slug or name, from list_brands (e.g. 'mr-assist' or 'Mr. Assist')");
const daysArg = z.number().int().min(1).max(90).optional().describe("Number of days ending yesterday (default 30)");

export function buildMcpServer(user: McpUser) {
  const ds: DataSource = isDemoMode() ? demoSource : adminSource;
  const server = new McpServer({ name: "amzcentric-os", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  async function brandOf(input: string): Promise<Brand> {
    const brands = await ds.listBrands();
    const q = input.trim().toLowerCase();
    const exact = brands.find((b) => b.slug === q || b.name.toLowerCase() === q);
    if (exact) return exact;
    const partial = brands.filter((b) => b.slug.includes(q) || b.name.toLowerCase().includes(q));
    if (partial.length === 1) return partial[0];
    throw new ToolError(
      `${partial.length ? "Ambiguous" : "Unknown"} brand "${input}". Brands: ${brands.map((b) => `${b.name} (${b.slug})`).join(", ") || "none"}.`,
    );
  }

  /** "Today" and "yesterday" in the brand's marketplace timezone. */
  async function clock(slug: string) {
    const status = await ds.brandStatus(slug);
    const today = todayInTz(status.timezone);
    const yesterday = addDays(today, -1);
    // Last day whose Amazon report has arrived: report-based ranges end here, like the dashboard.
    const through = status.dataThrough && status.dataThrough < yesterday ? status.dataThrough : yesterday;
    return { status, today, yesterday, through };
  }

  const run =
    <A,>(fn: (args: A) => Promise<unknown>) =>
    async (args: A) => {
      try {
        return ok(await fn(args));
      } catch (err) {
        if (err instanceof ToolError) return fail(err.message);
        console.error("mcp tool error", err);
        return fail(`Something went wrong: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

  const READ = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    "list_brands",
    {
      title: "List brands",
      description: "All brands (clients) in AmzCentric OS with their marketplaces and last-7-day ad performance vs the 7 days before.",
      annotations: READ,
    },
    run(async () => {
      const brands = await ds.listBrands();
      return Promise.all(
        brands.map(async (b) => {
          const { through: yesterday } = await clock(b.slug);
          const series = await ds.brandDaily(b.slug, addDays(yesterday, -13), yesterday);
          const now = sum(series.filter((d) => d.date > addDays(yesterday, -7)));
          const prev = sum(series.filter((d) => d.date <= addDays(yesterday, -7)));
          return { slug: b.slug, name: b.name, marketplaces: b.countries, profiles: b.profileCount, last_7_days: metrics(now), ...changes(now, prev) };
        }),
      );
    }),
  );

  server.registerTool(
    "get_brand_overview",
    {
      title: "Brand overview",
      description:
        "One brand's headline numbers: today so far (live), yesterday, last 7/14/30 days each vs the prior period, data freshness, and the attention-required alerts.",
      inputSchema: { brand: brandArg },
      annotations: READ,
    },
    run(async ({ brand }: { brand: string }) => {
      const b = await brandOf(brand);
      const { status, today, yesterday } = await clock(b.slug);
      const from = addDays(yesterday, -59);
      const [reported, hourlyToday, hourlyYesterday, cNow, cPrev, goal] = await Promise.all([
        ds.brandDaily(b.slug, from, yesterday),
        ds.hourly(b.slug, today),
        ds.hourly(b.slug, yesterday),
        ds.campaigns(b.slug, addDays(yesterday, -6), yesterday),
        ds.campaigns(b.slug, addDays(yesterday, -13), addDays(yesterday, -7)),
        ds.goal(b.slug, monthStart(yesterday)),
      ]);
      const byDate = new Map(reported.map((d) => [d.date, d]));
      const preliminary = !byDate.has(yesterday);
      if (preliminary) byDate.set(yesterday, { date: yesterday, ...sum(hourlyYesterday.map((h) => ({ ...h, units: 0 }))), totalSales: null });
      const daily: DailyPoint[] = eachDay(from, yesterday).map(
        (date) => byDate.get(date) ?? { date, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, units: 0, totalSales: null },
      );
      const win = (n: number, off = 0) => sum(daily.slice(daily.length - n - off, daily.length - off));
      const nowHour = hourInTz(status.timezone);
      const live = sum(hourlyToday.map((h) => ({ ...h, units: 0 })));
      const liveCompare = sum(hourlyYesterday.filter((h) => h.hour <= nowHour).map((h) => ({ ...h, units: 0 })));
      const mtd = sum(daily.filter((d) => d.date >= monthStart(yesterday)));
      const alerts = attentionItems({
        daily,
        campaignsNow: cNow,
        campaignsPrev: cPrev,
        goal,
        monthToDate: mtd,
        dayOfMonth: Number(yesterday.slice(8, 10)),
        daysInMonth: daysInMonth(yesterday),
      });
      return {
        brand: b.name,
        timezone: status.timezone,
        data_through: status.dataThrough,
        stream_last_hour: status.streamLastHour,
        today: { date: today, through_hour_local: nowHour, ...metrics(live), vs_yesterday_same_hours: changes(live, liveCompare) },
        yesterday: { date: yesterday, preliminary, ...metrics(win(1)), vs_same_day_last_week: changes(win(1), win(1, 7)) },
        last_7_days: { ...metrics(win(7)), ...changes(win(7), win(7, 7)) },
        last_14_days: { ...metrics(win(14)), ...changes(win(14), win(14, 14)) },
        last_30_days: { ...metrics(win(30)), ...changes(win(30), win(30, 30)) },
        attention_required: alerts.map((a) => ({ severity: a.tone, title: a.title, detail: a.detail })),
      };
    }),
  );

  server.registerTool(
    "get_campaigns",
    {
      title: "Campaigns",
      description: "Campaign-level performance for a brand over the last N days, with change vs the prior N days. Filter by ad type and sort.",
      inputSchema: {
        brand: brandArg,
        days: daysArg,
        ad_type: z.enum(["SP", "SB", "SD"]).optional().describe("Sponsored Products, Brands or Display"),
        sort_by: z.enum(["spend", "sales", "acos", "orders", "sales_change"]).optional().describe("Default spend"),
        limit: z.number().int().min(1).max(200).optional().describe("Default 25"),
      },
      annotations: READ,
    },
    run(async (a: { brand: string; days?: number; ad_type?: "SP" | "SB" | "SD"; sort_by?: string; limit?: number }) => {
      const b = await brandOf(a.brand);
      const { through: yesterday } = await clock(b.slug);
      const days = a.days ?? 30;
      const from = addDays(yesterday, -(days - 1));
      const [now, prev] = await Promise.all([
        ds.campaigns(b.slug, from, yesterday),
        ds.campaigns(b.slug, addDays(from, -days), addDays(from, -1)),
      ]);
      const prevBy = new Map(prev.map((c) => [c.campaignId, c]));
      const rows = now
        .filter((c) => !a.ad_type || c.adProduct === a.ad_type)
        .map((c) => ({
          campaign_id: c.campaignId,
          name: c.name,
          ad_type: c.adProduct,
          state: c.state,
          daily_budget: c.budget,
          ...metrics(c),
          sales_change_pct: p2(change(c.sales, prevBy.get(c.campaignId)?.sales)),
        }));
      const key = a.sort_by ?? "spend";
      const val = (r: (typeof rows)[number]) =>
        key === "sales" ? r.sales : key === "acos" ? r.acos_pct : key === "orders" ? r.orders : key === "sales_change" ? r.sales_change_pct : r.spend;
      rows.sort((x, y) => (val(y) ?? -Infinity) - (val(x) ?? -Infinity));
      return { brand: b.name, from, to: yesterday, campaigns_total: rows.length, campaigns: rows.slice(0, a.limit ?? 25) };
    }),
  );

  server.registerTool(
    "get_search_terms",
    {
      title: "Search terms",
      description:
        "Sponsored Products customer search terms for a brand. Views: all; wasted (10+ clicks, 0 orders: negative candidates); winners (2+ orders, ACOS under 25%); harvest (2+ orders from auto/broad/phrase: move to exact).",
      inputSchema: {
        brand: brandArg,
        days: daysArg,
        view: z.enum(["all", "wasted", "winners", "harvest"]).optional().describe("Default all"),
        contains: z.string().optional().describe("Only terms containing this text"),
        limit: z.number().int().min(1).max(200).optional().describe("Default 25, sorted by spend"),
      },
      annotations: READ,
    },
    run(async (a: { brand: string; days?: number; view?: string; contains?: string; limit?: number }) => {
      const b = await brandOf(a.brand);
      const { through: yesterday } = await clock(b.slug);
      const from = addDays(yesterday, -((a.days ?? 30) - 1));
      const terms = await ds.searchTerms(b.slug, from, yesterday);
      const view = a.view ?? "all";
      const q = a.contains?.toLowerCase();
      const rows = terms
        .filter((t) => (q ? t.searchTerm.toLowerCase().includes(q) : true))
        .filter((t) =>
          view === "wasted"
            ? t.clicks >= 10 && t.orders === 0
            : view === "winners"
              ? t.orders >= 2 && (acos(t) ?? 1) < 0.25
              : view === "harvest"
                ? t.orders >= 2 && t.matchType !== "EXACT"
                : true,
        )
        .sort((x, y) => y.cost - x.cost);
      const total = sum(rows);
      return {
        brand: b.name,
        from,
        to: yesterday,
        view,
        terms_matching: rows.length,
        total_spend_matching: r2(total.cost),
        terms: rows.slice(0, a.limit ?? 25).map((t) => ({
          search_term: t.searchTerm,
          targeting: t.targeting,
          match_type: t.matchType?.replace("TARGETING_EXPRESSION_PREDEFINED", "AUTO") ?? null,
          campaign: t.campaignName,
          campaign_id: t.campaignId,
          ...metrics(t),
        })),
      };
    }),
  );

  server.registerTool(
    "get_products",
    {
      title: "Products",
      description: "Advertised ASINs (Sponsored Products) for a brand over the last N days, with change vs the prior N days.",
      inputSchema: { brand: brandArg, days: daysArg },
      annotations: READ,
    },
    run(async (a: { brand: string; days?: number }) => {
      const b = await brandOf(a.brand);
      const { through: yesterday } = await clock(b.slug);
      const days = a.days ?? 30;
      const from = addDays(yesterday, -(days - 1));
      const [now, prev] = await Promise.all([ds.products(b.slug, from, yesterday), ds.products(b.slug, addDays(from, -days), addDays(from, -1))]);
      const prevBy = new Map(prev.map((p) => [p.asin, p]));
      return {
        brand: b.name,
        from,
        to: yesterday,
        products: now
          .sort((x, y) => y.sales - x.sales)
          .map((p) => {
            const before = prevBy.get(p.asin);
            return { asin: p.asin, sku: p.sku, ...metrics(p), ...(before ? changes(p, before) : {}) };
          }),
      };
    }),
  );

  server.registerTool(
    "get_hourly",
    {
      title: "Hourly",
      description:
        "Hour-by-hour impressions, clicks, spend, orders and sales for one day (marketplace time), with the funnel rates and each hour's 7-day average. From Marketing Stream; today is partial and 1–2 hours behind.",
      inputSchema: { brand: brandArg, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, default today") },
      annotations: READ,
    },
    run(async (a: { brand: string; date?: string }) => {
      const b = await brandOf(a.brand);
      const { today, status } = await clock(b.slug);
      const day = a.date ?? today;
      const prior = Array.from({ length: 7 }, (_, i) => addDays(day, -(i + 1)));
      const [hours, ...history] = await Promise.all([ds.hourly(b.slug, day), ...prior.map((d) => ds.hourly(b.slug, d))]);
      const avg = (h: number, k: "sales" | "cost" | "clicks") => history.reduce((s, d) => s + (d[h]?.[k] ?? 0), 0) / history.length;
      const total = sum(hours.map((h) => ({ ...h, units: 0 })));
      return {
        brand: b.name,
        date: day,
        timezone: status.timezone,
        partial_day: day === today,
        totals: { ...metrics(total), aov: r2(total.orders ? total.sales / total.orders : null) },
        hours: hours.map((h) => ({
          hour: h.hour,
          impressions: h.impressions,
          clicks: h.clicks,
          spend: r2(h.cost),
          orders: h.orders,
          sales: r2(h.sales),
          ctr_pct: p2(h.impressions ? h.clicks / h.impressions : null),
          cvr_pct: p2(h.clicks ? h.orders / h.clicks : null),
          acos_pct: p2(h.sales ? h.cost / h.sales : null),
          avg7_clicks: r2(avg(h.hour, "clicks")),
          avg7_spend: r2(avg(h.hour, "cost")),
          avg7_sales: r2(avg(h.hour, "sales")),
        })),
      };
    }),
  );

  server.registerTool(
    "get_what_changed",
    {
      title: "What changed",
      description:
        "Explains a sales move: the last N days vs the N days before, campaign and product movers with their driver (Traffic, Conversion, Order value, Paused, New, Flat), and the actions logged in that window.",
      inputSchema: { brand: brandArg, days: z.number().int().min(1).max(30).optional().describe("Default 7 (week over week)") },
      annotations: READ,
    },
    run(async (a: { brand: string; days?: number }) => {
      const b = await brandOf(a.brand);
      const { through: yesterday } = await clock(b.slug);
      const days = a.days ?? 7;
      const from = addDays(yesterday, -(days - 1));
      const prevFrom = addDays(from, -days);
      const prevTo = addDays(from, -1);
      const [cNow, cPrev, pNow, pPrev, actions] = await Promise.all([
        ds.campaigns(b.slug, from, yesterday),
        ds.campaigns(b.slug, prevFrom, prevTo),
        ds.products(b.slug, from, yesterday),
        ds.products(b.slug, prevFrom, prevTo),
        ds.actions(b.slug, 200),
      ]);
      const zero: Totals = { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, units: 0 };
      const inWindow = actions.filter((x) => x.actionDate >= prevFrom && x.actionDate <= yesterday);
      const prevBy = new Map(cPrev.map((c) => [c.campaignId, c]));
      const ids = new Set([...cNow.map((c) => c.campaignId), ...cPrev.map((c) => c.campaignId)]);
      const movers = [...ids]
        .map((id) => {
          const n = cNow.find((c) => c.campaignId === id);
          const p = prevBy.get(id);
          const meta = (n ?? p)!;
          const now = n ?? zero;
          const prev = p ?? zero;
          const logged = inWindow.filter((x) => x.campaignId === id).map((x) => `${x.actionDate} ${x.category}: ${x.description}`);
          return {
            campaign: meta.name,
            campaign_id: id,
            ad_type: meta.adProduct,
            sales_before: r2(prev.sales),
            sales_now: r2(now.sales),
            sales_change: r2(now.sales - prev.sales),
            spend_change: r2(now.cost - prev.cost),
            acos_now_pct: p2(acos(now)),
            driver: salesDriver(now, prev, meta.state),
            logged_actions: logged,
          };
        })
        .sort((x, y) => Math.abs(y.sales_change ?? 0) - Math.abs(x.sales_change ?? 0));
      const pPrevBy = new Map(pPrev.map((p) => [p.asin, p]));
      const products = pNow
        .map((p) => {
          const before = pPrevBy.get(p.asin) ?? zero;
          return { asin: p.asin, sku: p.sku, sales_now: r2(p.sales), sales_change: r2(p.sales - before.sales), acos_now_pct: p2(acos(p)), driver: salesDriver(p, before) };
        })
        .sort((x, y) => Math.abs(y.sales_change ?? 0) - Math.abs(x.sales_change ?? 0));
      const now = sum(cNow);
      const prev = sum(cPrev);
      return {
        brand: b.name,
        period: { from, to: yesterday },
        compared_with: { from: prevFrom, to: prevTo },
        totals_now: metrics(now),
        totals_before: metrics(prev),
        ...changes(now, prev),
        campaign_movers: movers.slice(0, 15),
        product_movers: products.slice(0, 10),
        actions_logged_in_window: inWindow.map((x) => ({ date: x.actionDate, category: x.category, description: x.description, campaign: x.campaignName, by: x.authorEmail })),
      };
    }),
  );

  server.registerTool(
    "get_action_log",
    {
      title: "Action log",
      description:
        "The team's logged changes for a brand, newest first, each measured: sales/day and ACOS for the 14 days before vs the days after (up to 14). status is measuring (under 3 days), lifted (>+5% sales/day), dropped (<−5%) or flat.",
      inputSchema: { brand: brandArg, limit: z.number().int().min(1).max(100).optional().describe("Default 20") },
      annotations: READ,
    },
    run(async (a: { brand: string; limit?: number }) => {
      const b = await brandOf(a.brand);
      const { through: yesterday } = await clock(b.slug);
      const actions = await ds.actions(b.slug, a.limit ?? 20);
      const measured = await measureActions(ds, b.slug, actions, yesterday);
      return {
        brand: b.name,
        actions: measured.map((m) => {
          const s = impactSummary(m);
          return {
            id: m.a.id,
            date: m.a.actionDate,
            category: m.a.category,
            description: m.a.description,
            campaign: m.a.campaignName ?? "Whole brand",
            campaign_id: m.a.campaignId,
            logged_by: m.a.authorEmail,
            impact: {
              status: s.status,
              days_measured: s.daysMeasured,
              sales_per_day_before: r2(s.salesPerDayBefore),
              sales_per_day_after: r2(s.salesPerDayAfter),
              sales_per_day_change_pct: p2(s.salesPerDayChange),
              acos_before_pct: p2(s.acosBefore),
              acos_after_pct: p2(s.acosAfter),
            },
          };
        }),
      };
    }),
  );

  server.registerTool(
    "get_report",
    {
      title: "Daily / weekly / monthly report",
      description:
        "The team's reporting sheet for a brand, one row per day, week or month: total orders, PPC orders, organic orders, total sales, PPC sales, PPC spend, clicks, organic ratio, PPC ratio, TACOS, ACOS, avg CPC, PPC CVR, plus a total. Total orders / total sales and everything derived from them are null until SP-API is connected. The newest period can be partial.",
      inputSchema: {
        brand: brandArg,
        period: z.enum(["daily", "weekly", "monthly"]).optional().describe("Default weekly"),
        count: z.number().int().min(1).max(104).optional().describe("How many periods ending with the latest (default 30 days / 12 weeks / 6 months)"),
        week_start: z.enum(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]).optional().describe("Default monday"),
      },
      annotations: READ,
    },
    run(async (a: { brand: string; period?: Period; count?: number; week_start?: string }) => {
      const b = await brandOf(a.brand);
      const { through: yesterday } = await clock(b.slug);
      const period = a.period ?? "weekly";
      const ws = a.week_start ? WEEKDAYS.findIndex((d) => d.toLowerCase() === a.week_start) : DEFAULT_WEEK_START;
      const count = a.count ?? (period === "daily" ? 30 : period === "weekly" ? 12 : 6);
      const win = reportWindow(period, count, yesterday, ws);
      const daily = await ds.brandDaily(b.slug, win.from, win.to);
      const rep = buildReport(period, daily, buckets(period, win.from, win.to, ws), yesterday);
      const out = (m: ReturnType<typeof buildReport>["total"]) => ({
        total_orders: m.totalOrders,
        ppc_orders: m.ppcOrders,
        organic_orders: m.organicOrders,
        total_sales: r2(m.totalSales),
        ppc_sales: r2(m.ppcSales),
        ppc_spend: r2(m.ppcSpend),
        clicks: m.clicks,
        organic_ratio_pct: p2(m.organicRatio),
        ppc_ratio_pct: p2(m.ppcRatio),
        tacos_pct: p2(m.tacos),
        acos_pct: p2(m.acos),
        avg_cpc: r2(m.cpc),
        ppc_cvr_pct: p2(m.cvr),
      });
      return {
        brand: b.name,
        period,
        week_starts: period === "weekly" ? WEEKDAYS[ws] : undefined,
        data_through: yesterday,
        sp_api_connected: rep.total.totalSales != null,
        rows: rep.rows.map((r) => ({ period: r.label, start: r.start, end: r.end, partial: r.partial, ...out(r) })),
        total: out(rep.total),
      };
    }),
  );

  server.registerTool(
    "get_goals",
    {
      title: "Goals",
      description: "A brand's monthly targets (sales, ad spend budget, ACOS) with month-to-date actuals, pacing and month-end projection.",
      inputSchema: { brand: brandArg, month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM, default current month") },
      annotations: READ,
    },
    run(async (a: { brand: string; month?: string }) => {
      const b = await brandOf(a.brand);
      const { through: yesterday } = await clock(b.slug);
      const month = a.month ? `${a.month}-01` : monthStart(yesterday);
      const dim = daysInMonth(month);
      const monthEnd = addDays(month, dim - 1);
      const through = monthEnd < yesterday ? monthEnd : yesterday;
      const elapsed = through < month ? 0 : Number(through.slice(8, 10));
      const [goal, daily] = await Promise.all([ds.goal(b.slug, month), elapsed ? ds.brandDaily(b.slug, month, through) : Promise.resolve([])]);
      const mtd = sum(daily);
      // Same basis as the Goals page: total sales when SP-API provides them, else ad sales.
      const hasTotal = daily.some((d) => d.totalSales != null);
      const salesActual = hasTotal ? (mtd.totalSales ?? 0) : mtd.sales;
      const projSales = elapsed ? (salesActual / elapsed) * dim : null;
      const projSpend = elapsed ? (mtd.cost / elapsed) * dim : null;
      const pace = (actual: number, target: number | null | undefined) => (target && elapsed ? p2(actual / ((target * elapsed) / dim)) : null);
      return {
        brand: b.name,
        month: month.slice(0, 7),
        days_elapsed: elapsed,
        days_in_month: dim,
        targets: goal ? { sales: goal.salesTarget, spend_budget: goal.spendBudget, acos_pct: p2(goal.acosTarget) } : null,
        month_to_date: metrics(mtd),
        projected_month_end: { sales: r2(projSales), spend: r2(projSpend) },
        sales_basis: hasTotal ? "total sales" : "ad-attributed sales",
        sales_month_to_date: r2(salesActual),
        pacing: { sales_pct_of_expected: pace(salesActual, goal?.salesTarget), spend_pct_of_expected: pace(mtd.cost, goal?.spendBudget) },
      };
    }),
  );

  server.registerTool(
    "log_action",
    {
      title: "Log an action",
      description:
        "Add an entry to a brand's Action Log, recorded under the signed-in teammate's name. Use for changes made in Amazon (bids, budgets, negatives, launches, pauses, listing, pricing). One change per entry; put numbers in the description. The app then measures its impact over the next 14 days.",
      inputSchema: {
        brand: brandArg,
        category: z.enum(ACTION_CATEGORIES.map((c) => c.value) as [ActionCategory, ...ActionCategory[]]).describe(
          "bid, budget, negative, launch, pause, listing, pricing or other",
        ),
        description: z.string().min(3).max(500).describe("What was changed, with numbers, e.g. 'Budget $60 → $90/day'"),
        action_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Day the change went live (YYYY-MM-DD), default today"),
        campaign: z.string().optional().describe("Campaign ID or (part of) its name; omit for a whole-brand change"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    run(async (a: { brand: string; category: ActionCategory; description: string; action_date?: string; campaign?: string }) => {
      const b = await brandOf(a.brand);
      const { today, yesterday } = await clock(b.slug);
      const date = a.action_date ?? today;
      if (date > today) throw new ToolError(`action_date ${date} is in the future (today is ${today}).`);
      let campaign: { id: string; name: string } | null = null;
      if (a.campaign) {
        const list = await ds.campaigns(b.slug, addDays(yesterday, -89), yesterday);
        const q = a.campaign.trim().toLowerCase();
        const exact = list.find((c) => c.campaignId === a.campaign!.trim() || c.name.toLowerCase() === q);
        const matches = exact ? [exact] : list.filter((c) => c.name.toLowerCase().includes(q));
        if (matches.length === 0) throw new ToolError(`No campaign matching "${a.campaign}" in ${b.name}. Use get_campaigns to find it, or omit campaign for a whole-brand change.`);
        if (matches.length > 1)
          throw new ToolError(`"${a.campaign}" matches ${matches.length} campaigns: ${matches.slice(0, 10).map((c) => `${c.name} (${c.campaignId})`).join("; ")}. Pass the campaign ID.`);
        campaign = { id: matches[0].campaignId, name: matches[0].name };
      }
      const entry = {
        brand_slug: b.slug,
        category: a.category,
        description: a.description.trim(),
        action_date: date,
        campaign_id: campaign?.id ?? null,
        campaign_name: campaign?.name ?? null,
        author_email: user.email,
      };
      if (isDemoMode()) return { saved: false, note: "Demo mode: nothing is saved.", entry };
      const { data, error } = await createAdminClient().from("action_log").insert(entry).select("id").single();
      if (error) throw new ToolError(`Couldn't save: ${error.message}`);
      return { saved: true, id: data.id, ...entry, note: "Logged. Impact appears in get_action_log after 3 days and is final after 14." };
    }),
  );

  registerMeetingTools(server, {
    user,
    brandOf,
    today: async (slug) => (slug ? (await clock(slug)).today : todayInTz("America/Los_Angeles")),
    run,
    fail: (message: string) => {
      throw new ToolError(message);
    },
  });

  return server;
}
