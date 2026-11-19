import { addDays, daysBetween } from "@/lib/dates";
import { acos, change, type Totals } from "@/lib/metrics";
import type { ActionEntry, DataSource } from "@/lib/data/types";

/** Each logged action is compared with the 14 days before it. */
export const IMPACT_WINDOW = 14;

export type MeasuredAction = { a: ActionEntry; afterDays: number; before: Totals | null; after: Totals | null };

export async function measureActions(ds: DataSource, slug: string, actions: ActionEntry[], yesterday: string): Promise<MeasuredAction[]> {
  return Promise.all(
    actions.map(async (a) => {
      const afterEnd = addDays(a.actionDate, IMPACT_WINDOW - 1) < yesterday ? addDays(a.actionDate, IMPACT_WINDOW - 1) : yesterday;
      const afterDays = daysBetween(a.actionDate, afterEnd) + 1;
      if (afterDays < 3) return { a, afterDays, before: null, after: null };
      const [before, after] = await Promise.all([
        ds.window(slug, a.campaignId, addDays(a.actionDate, -IMPACT_WINDOW), addDays(a.actionDate, -1)),
        ds.window(slug, a.campaignId, a.actionDate, afterEnd),
      ]);
      return { a, afterDays, before, after };
    }),
  );
}

/** Sales/day and ACOS before vs after, and a verdict (±5% sales/day). */
export function impactSummary(m: MeasuredAction) {
  if (!m.before || !m.after) {
    return { status: "measuring" as const, daysMeasured: Math.max(m.afterDays, 0), salesPerDayBefore: null, salesPerDayAfter: null, salesPerDayChange: null, acosBefore: null, acosAfter: null };
  }
  const before = m.before.sales / IMPACT_WINDOW;
  const after = m.after.sales / m.afterDays;
  const d = change(after, before);
  return {
    status: (d ?? 0) > 0.05 ? ("lifted" as const) : (d ?? 0) < -0.05 ? ("dropped" as const) : ("flat" as const),
    daysMeasured: m.afterDays,
    salesPerDayBefore: before,
    salesPerDayAfter: after,
    salesPerDayChange: d,
    acosBefore: acos(m.before),
    acosAfter: acos(m.after),
  };
}
