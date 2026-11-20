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

export type Range = { days: number; from: string; to: string; prevFrom: string; prevTo: string; custom?: boolean };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_CUSTOM_DAYS = 366;

/**
 * A from/to range picked by hand, compared against the same number of days just before it.
 * `to` is capped at `maxTo` (the last reported day). Returns null when the dates are unusable.
 */
export function customRange(from: string | undefined, to: string | undefined, maxTo: string): Range | null {
  if (!from || !YMD.test(from) || Number.isNaN(Date.parse(from))) return null;
  let end = to && YMD.test(to) && !Number.isNaN(Date.parse(to)) ? to : maxTo;
  if (end > maxTo) end = maxTo;
  if (from > end) return null;
  let start = from;
  if (daysBetween(start, end) + 1 > MAX_CUSTOM_DAYS) start = addDays(end, -(MAX_CUSTOM_DAYS - 1));
  const days = daysBetween(start, end) + 1;
  return { days, from: start, to: end, prevTo: addDays(start, -1), prevFrom: addDays(start, -days), custom: true };
}

/** Query-string params that reproduce a range (preset days or custom from/to). */
export function rangeParams(r: Range): Record<string, string> {
  return r.custom ? { from: r.from, to: r.to } : { range: String(r.days) };
}

export const RANGE_OPTIONS = [7, 14, 30, 60, 90] as const;

/** Range ending yesterday (reports are complete through yesterday). */
export function resolveRange(raw: string | string[] | undefined, fallback = 30, end?: string): Range {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  const days = (RANGE_OPTIONS as readonly number[]).includes(n) || (end && Number.isInteger(n) && n > 0 && n <= 90) ? n : fallback;
  const to = end ?? addDays(todayUtc(), -1);
  const from = addDays(to, -(days - 1));
  return { days, from, to, prevTo: addDays(from, -1), prevFrom: addDays(from, -days) };
}
