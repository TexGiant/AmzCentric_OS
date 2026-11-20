import type { DailyPoint } from "@/lib/data/types";
import { addDays, daysBetween, monthStart, shortDate } from "@/lib/dates";
import { sum, type Totals } from "@/lib/metrics";

/*
 * The Reports tab: the team's weekly sheet, by day, week or month.
 * Ads API / Marketing Stream fill PPC columns; SP-API columns (total orders, total sales and
 * everything derived from them) stay empty until Seller Central is connected.
 */

export type Period = "daily" | "weekly" | "monthly";
export const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];
export const PERIOD_PRESETS: Record<Period, number[]> = { daily: [7, 14, 30, 60, 90], weekly: [4, 8, 12, 26, 52], monthly: [3, 6, 12, 24] };
export const DEFAULT_COUNT: Record<Period, number> = { daily: 30, weekly: 12, monthly: 6 };
export const PRESET_UNIT: Record<Period, string> = { daily: "D", weekly: "W", monthly: "M" };
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DEFAULT_WEEK_START = 1; // Monday
export const WEEK_START_COOKIE = "amz_week_start";

const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

export function weekStartOf(ymd: string, ws: number): string {
  return addDays(ymd, -((dow(ymd) - ws + 7) % 7));
}

export function addMonths(ymd: string, n: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

const monthEnd = (ymd: string) => addDays(addMonths(monthStart(ymd), 1), -1);

/** The last `count` days / weeks / months, ending with the one that contains `through`. */
export function reportWindow(period: Period, count: number, through: string, ws: number): { from: string; to: string } {
  if (period === "daily") return { from: addDays(through, -(count - 1)), to: through };
  if (period === "weekly") return { from: addDays(weekStartOf(through, ws), -7 * (count - 1)), to: through };
  return { from: addMonths(monthStart(through), -(count - 1)), to: through };
}

export type Bucket = { start: string; end: string; fullStart: string; fullEnd: string };

/** Calendar-aligned periods covering from..to; the first and last can be partial. */
export function buckets(period: Period, from: string, to: string, ws: number): Bucket[] {
  const out: Bucket[] = [];
  let cur = period === "daily" ? from : period === "weekly" ? weekStartOf(from, ws) : monthStart(from);
  while (cur <= to) {
    const fullEnd = period === "daily" ? cur : period === "weekly" ? addDays(cur, 6) : monthEnd(cur);
    out.push({ fullStart: cur, fullEnd, start: cur < from ? from : cur, end: fullEnd > to ? to : fullEnd });
    cur = addDays(fullEnd, 1);
  }
  return out;
}

export type ReportRow = {
  label: string;
  start: string;
  end: string;
  startLabel: string;
  endLabel: string;
  days: number;
  partial: boolean;
  totalOrders: number | null;
  ppcOrders: number;
  organicOrders: number | null;
  totalSales: number | null;
  ppcSales: number;
  ppcSpend: number;
  clicks: number;
  impressions: number;
  organicRatio: number | null;
  ppcRatio: number | null;
  tacos: number | null;
  acos: number | null;
  cpc: number | null;
  cvr: number | null;
};

const div = (a: number | null, b: number | null) => (a == null || b == null || b <= 0 ? null : a / b);
const longDate = (ymd: string) => `${shortDate(ymd)}, ${ymd.slice(0, 4)}`;

/** Sheet math, for one period or a total. SP-API values count only when every day has them. */
export function reportMetrics(t: Totals, spApiComplete: boolean) {
  const totalOrders = spApiComplete ? (t.totalOrders ?? null) : null;
  const totalSales = spApiComplete ? (t.totalSales ?? null) : null;
  const organicOrders = totalOrders == null ? null : Math.max(0, totalOrders - t.orders);
  return {
    totalOrders,
    ppcOrders: t.orders,
    organicOrders,
    totalSales,
    ppcSales: t.sales,
    ppcSpend: t.cost,
    clicks: t.clicks,
    impressions: t.impressions,
    organicRatio: div(organicOrders, totalOrders),
    ppcRatio: div(totalOrders == null ? null : t.orders, totalOrders),
    tacos: div(t.cost, totalSales),
    acos: div(t.cost, t.sales),
    cpc: div(t.cost, t.clicks),
    cvr: div(t.orders, t.clicks),
  };
}

const complete = (days: DailyPoint[], n: number) => days.length === n && days.every((d) => d.totalSales != null && d.totalOrders != null);

export function buildReport(period: Period, daily: DailyPoint[], bs: Bucket[], through: string) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const rows: ReportRow[] = bs.map((b) => {
    const days = daysBetween(b.start, b.end) + 1;
    const pts: DailyPoint[] = [];
    for (let d = b.start; d <= b.end; d = addDays(d, 1)) {
      const p = byDate.get(d);
      if (p) pts.push(p);
    }
    const partial = b.start !== b.fullStart || b.end !== b.fullEnd;
    const label =
      period === "daily"
        ? `${shortDate(b.start)} · ${new Date(`${b.start}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}`
        : period === "weekly"
          ? `Week of ${shortDate(b.fullStart)}`
          : new Date(`${b.fullStart}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    return {
      label: partial ? `${label} (partial)` : label,
      start: b.start,
      end: b.end,
      startLabel: longDate(b.start),
      endLabel: longDate(b.end),
      days,
      partial,
      ...reportMetrics(sum(pts), complete(pts, days)),
    };
  });
  const all = daily.filter((d) => bs.length && d.date >= bs[0].start && d.date <= bs[bs.length - 1].end);
  const totalDays = bs.length ? daysBetween(bs[0].start, bs[bs.length - 1].end) + 1 : 0;
  const total = reportMetrics(sum(all), complete(all, totalDays));
  return { rows, total, totalDays, through };
}
