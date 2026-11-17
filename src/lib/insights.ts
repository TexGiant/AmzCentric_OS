import { acos, change, cvr, sum, type Totals } from "@/lib/metrics";
import { pct } from "@/lib/format";
import type { CampaignRow, DailyPoint, Goal } from "@/lib/data/types";

export type Insight = { kind: "acos" | "cvr" | "pace" | "spend" | "budget"; tone: "bad" | "warn" | "good"; title: string; detail: string };

/** Simple rules that flag problems before they grow. */
export function attentionItems(opts: {
  daily: DailyPoint[];
  campaignsNow: CampaignRow[];
  campaignsPrev: CampaignRow[];
  goal: Goal | null;
  monthToDate: Totals | null;
  dayOfMonth: number;
  daysInMonth: number;
}): Insight[] {
  const out: Insight[] = [];
  const last7 = sum(opts.daily.slice(-7));
  const prev7 = sum(opts.daily.slice(-14, -7));

  const a1 = acos(last7);
  const a0 = acos(prev7);
  if (a1 != null && a0 != null && a1 > a0 * 1.12) {
    out.push({ kind: "acos", tone: "bad", title: "ACOS rising", detail: `${pct(a1)} last 7 days vs ${pct(a0)} the week before` });
  }
  const c1 = cvr(last7);
  const c0 = cvr(prev7);
  if (c1 != null && c0 != null && c1 < c0 * 0.88) {
    out.push({ kind: "cvr", tone: "warn", title: "Conversion rate drop", detail: `${pct(c1)} vs ${pct(c0)} the week before` });
  }

  // Campaigns whose ACOS jumped while still spending meaningfully.
  const prevById = new Map(opts.campaignsPrev.map((c) => [c.campaignId, c]));
  const worst = opts.campaignsNow
    .filter((c) => c.cost > 50)
    .map((c) => ({ c, now: acos(c), before: acos(prevById.get(c.campaignId) ?? c) }))
    .filter((x) => x.now != null && x.before != null && x.now > x.before * 1.3)
    .sort((a, b) => b.c.cost - a.c.cost)[0];
  if (worst) {
    out.push({ kind: "acos", tone: "warn", title: "Campaign ACOS spike", detail: `${worst.c.name} · ${pct(worst.now)} vs ${pct(worst.before)}` });
  }

  const spendDelta = change(last7.cost, prev7.cost);
  if (spendDelta != null && spendDelta > 0.3) {
    out.push({ kind: "spend", tone: "warn", title: "Spend jumped", detail: `Up ${pct(spendDelta)} week over week` });
  }

  if (opts.goal?.salesTarget && opts.monthToDate) {
    const actual = opts.monthToDate.totalSales ?? opts.monthToDate.sales;
    const expected = (opts.goal.salesTarget * opts.dayOfMonth) / opts.daysInMonth;
    if (expected > 0 && actual < expected * 0.95) {
      out.push({ kind: "pace", tone: "warn", title: "Goal pacing behind", detail: `${pct(actual / expected, 0)} of expected month-to-date sales` });
    } else if (expected > 0 && actual > expected * 1.05) {
      out.push({ kind: "pace", tone: "good", title: "Ahead of goal", detail: `${pct(actual / expected, 0)} of expected month-to-date sales` });
    }
  }
  return out.slice(0, 5);
}

export type Driver = "Traffic" | "Conversion" | "Order value" | "Paused" | "New" | "Flat";

/** Decompose a sales change into clicks × CVR × AOV and name the biggest factor. */
export function salesDriver(now: Totals, prev: Totals, state?: string | null): Driver {
  if (prev.sales <= 0 && now.sales > 0) return "New";
  if (now.cost === 0 && prev.cost > 0) return state === "paused" ? "Paused" : "Traffic";
  if (prev.clicks === 0 || now.clicks === 0 || prev.orders === 0 || now.orders === 0) return now.clicks < prev.clicks ? "Traffic" : "Conversion";
  const parts: Array<[Driver, number]> = [
    ["Traffic", Math.log(now.clicks / prev.clicks)],
    ["Conversion", Math.log(now.orders / now.clicks / (prev.orders / prev.clicks))],
    ["Order value", Math.log(now.sales / now.orders / (prev.sales / prev.orders))],
  ];
  const top = parts.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return Math.abs(top[1]) < 0.05 ? "Flat" : top[0];
}
