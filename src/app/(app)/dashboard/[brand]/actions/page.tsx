import { Trash2 } from "lucide-react";
import { Card, CardHeader, Kpi, PageHeader, Pill, cn } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { deleteAction } from "@/app/workspace-actions";
import { data, ACTION_CATEGORIES } from "@/lib/data";
import { addDays, daysBetween, shortDate, todayUtc } from "@/lib/dates";
import { money, pct } from "@/lib/format";
import { acos, change } from "@/lib/metrics";
import { getBrandOr404, type BrandParams } from "@/lib/page";

const WINDOW = 14;

export default async function ActionLogPage({ params }: { params: BrandParams }) {
  const { brand: slug } = await params;
  const brand = await getBrandOr404(slug);
  const ds = data();
  const today = todayUtc();
  const yesterday = addDays(today, -1);

  const [actions, campaigns] = await Promise.all([
    ds.actions(slug, 100),
    ds.campaigns(slug, addDays(yesterday, -29), yesterday),
  ]);

  // Before = 14 days before the action; after = action day + 13 days (or up to yesterday).
  const measured = await Promise.all(
    actions.slice(0, 40).map(async (a) => {
      const afterEnd = addDays(a.actionDate, WINDOW - 1) < yesterday ? addDays(a.actionDate, WINDOW - 1) : yesterday;
      const afterDays = daysBetween(a.actionDate, afterEnd) + 1;
      if (afterDays < 3) return { a, afterDays, before: null, after: null };
      const [before, after] = await Promise.all([
        ds.window(slug, a.campaignId, addDays(a.actionDate, -WINDOW), addDays(a.actionDate, -1)),
        ds.window(slug, a.campaignId, a.actionDate, afterEnd),
      ]);
      return { a, afterDays, before, after };
    }),
  );

  const label = (c: string) => ACTION_CATEGORIES.find((x) => x.value === c)?.label ?? c;
  const last30 = actions.filter((a) => a.actionDate >= addDays(today, -30));
  const wins = measured.filter((m) => m.before && m.after && (change(m.after.sales / m.afterDays, m.before.sales / WINDOW) ?? 0) > 0.05).length;
  const scored = measured.filter((m) => m.before && m.after).length;

  return (
    <>
      <PageHeader
        eyebrow="Action log"
        title="Every change, measured"
        subtitle={`${brand.name} · each action is compared with the ${WINDOW} days before it`}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Actions · 30 days" value={String(last30.length)} />
        <Kpi label="Measured actions" value={String(scored)} />
        <Kpi label="Lifted sales/day >5%" value={scored ? pct(wins / scored, 0) : "—"} sub={`${wins} of ${scored}`} />
      </div>

      <Card className="mt-6">
        <CardHeader title="Log an action" />
        <ActionForm
          brand={slug}
          today={today}
          campaigns={campaigns.map((c) => ({ id: c.campaignId, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))}
        />
      </Card>

      <Card className="mt-4">
        <CardHeader title="History" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-y border-line bg-canvas/60 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                <th className="py-2.5 pr-3 pl-5 text-left">Date</th>
                <th className="px-3 text-left">Change</th>
                <th className="px-3 text-right">Sales/day before → after</th>
                <th className="px-3 text-right">ACOS before → after</th>
                <th className="px-3 text-left">Result</th>
                <th className="pr-5" />
              </tr>
            </thead>
            <tbody>
              {measured.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted">
                    No actions yet. Log bids, budgets, negatives and listing changes above to measure their impact.
                  </td>
                </tr>
              )}
              {measured.map(({ a, afterDays, before, after }) => {
                const spdB = before ? before.sales / WINDOW : null;
                const spdA = after ? after.sales / afterDays : null;
                const d = change(spdA, spdB);
                const aB = before ? acos(before) : null;
                const aA = after ? acos(after) : null;
                return (
                  <tr key={a.id} className="border-b border-line/70 align-top last:border-0">
                    <td className="py-3 pr-3 pl-5 whitespace-nowrap text-ink-2">{shortDate(a.actionDate)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone="brand">{label(a.category)}</Pill>
                        <span className="text-xs text-faint">{a.campaignName ?? "Whole brand"}</span>
                      </div>
                      <div className="mt-1 text-ink">{a.description}</div>
                      {a.authorEmail && <div className="text-xs text-faint">{a.authorEmail}</div>}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap tabular">
                      {spdB == null ? "—" : `${money(spdB)} → ${money(spdA)}`}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap tabular">{aB == null ? "—" : `${pct(aB)} → ${pct(aA)}`}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {!after ? (
                        <Pill>Measuring · day {Math.max(afterDays, 0)}</Pill>
                      ) : (
                        <span className={cn("text-xs font-semibold", (d ?? 0) > 0.05 ? "text-good" : (d ?? 0) < -0.05 ? "text-bad" : "text-muted")}>
                          {d == null ? "—" : `${d > 0 ? "+" : ""}${(d * 100).toFixed(0)}% sales/day`}
                          {afterDays < WINDOW && <span className="ml-1 font-normal text-faint">({afterDays}d so far)</span>}
                        </span>
                      )}
                    </td>
                    <td className="pr-5 text-right">
                      <form action={deleteAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="brand" value={slug} />
                        <button className="rounded-lg p-1.5 text-faint hover:bg-bad-soft hover:text-bad" aria-label="Delete">
                          <Trash2 className="size-4" strokeWidth={1.5} />
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
