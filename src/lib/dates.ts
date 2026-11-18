/** All dates are plain "YYYY-MM-DD" strings to avoid timezone drift. */

export function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return toYmd(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Today's date in an IANA timezone (Amazon profiles report in marketplace time). */
export function todayInTz(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Current hour (0–23) in an IANA timezone. */
export function hourInTz(tz: string, now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
}

export function todayUtc(): string {
  return toYmd(new Date());
}

export function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function daysInMonth(ymd: string): number {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function shortDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function chunkRange(from: string, to: string, maxDays: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let start = from;
  while (start <= to) {
    const end = addDays(start, maxDays - 1) < to ? addDays(start, maxDays - 1) : to;
    out.push([start, end]);
    start = addDays(end, 1);
  }
  return out;
}

export type Range = { days: number; from: string; to: string; prevFrom: string; prevTo: string };

export const RANGE_OPTIONS = [7, 14, 30, 60, 90] as const;

/** Range ending yesterday (reports are complete through yesterday). */
export function resolveRange(raw: string | string[] | undefined, fallback = 30): Range {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  const days = (RANGE_OPTIONS as readonly number[]).includes(n) ? n : fallback;
  const to = addDays(todayUtc(), -1);
  const from = addDays(to, -(days - 1));
  return { days, from, to, prevTo: addDays(from, -1), prevFrom: addDays(from, -days) };
}
