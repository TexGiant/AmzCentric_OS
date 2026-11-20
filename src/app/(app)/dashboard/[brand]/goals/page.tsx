import Link from "next/link";
import { Card, CardHeader, Kpi, PageHeader, Progress, buttonClass, cn } from "@/components/ui";
import { Legend, PaceChart } from "@/components/charts";
import { GoalForm } from "@/components/forms";
import { data } from "@/lib/data";
import { addDays, daysInMonth, eachDay, monthStart } from "@/lib/dates";
import { money, pct } from "@/lib/format";
import { acos, sum } from "@/lib/metrics";
import { brandClock, getBrandOr404, param, type BrandParams, type SearchParams } from "@/lib/page";

function shiftMonth(month: string, n: number) {
  const d = new Date(`${month}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export default async function GoalsPage({ params, searchParams }: { params: BrandParams; searchParams: SearchParams }) {
  const { brand: slug } = await params;
  const sp = await searchParams;
  const brand = await getBrandOr404(slug);
  // Last day with report data, in the marketplace timezone.
  const yesterday = (await brandClock(slug)).through;
  const current = monthStart(yesterday);
  const requested = param(sp, "month");
  const month = requested && /^\d{4}-\d{2}-01$/.test(requested) && requested <= current ? requested : current;
  const dim = daysInMonth(month);
  const monthEnd = addDays(month, dim - 1);
  const through = monthEnd < yesterday ? monthEnd : yesterday;
  const elapsed = Number(through.slice(8, 10));

  const ds = data();
  const [goal, daily] = await Promise.all([ds.goal(slug, month), ds.brandDaily(slug, month, through)]);
  const hasTotal = daily.some((d) => d.totalSales != null);
  const salesOf = (d: { sales: number; totalSales?: number | null }) => (hasTotal ? (d.totalSales ?? 0) : d.sales);
  const mtd = sum(daily);
  const mtdSales = hasTotal ? (mtd.totalSales ?? 0) : mtd.sales;
  const projected = elapsed ? (mtdSales / elapsed) * dim : 0;
  const projectedSpend = elapsed ? (mtd.cost / elapsed) * dim : 0;

  let running = 0;
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const chart = eachDay(month, monthEnd).map((date, i) => {
    const d = byDate.get(date);
    if (date <= through) running += d ? salesOf(d) : 0;
    const target = goal?.salesTarget ? (goal.salesTarget * (i + 1)) / dim : 0;
    return {
      date,
      actual: date <= through ? running : null,
      target,
      projected: date === through ? running : date > through && elapsed ? (mtdSales / elapsed) * (i + 1) : null,
    };
  });

  const salesPace = goal?.salesTarget ? mtdSales / ((goal.salesTarget * elapsed) / dim) : null;
  const spendPace = goal?.spendBudget ? mtd.cost / ((goal.spendBudget * elapsed) / dim) : null;
  const monthLabel = new Date(`${month}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        eyebrow="Goals"
        title={`${monthLabel} goals`}
        subtitle={`${brand.name} · ${elapsed} of ${dim} days · ${hasTotal ? "total sales" : "ad sales (total sales arrive with SP-API)"}`}
        right={
          <div className="flex gap-1">
            <Link href={`/dashboard/${slug}/goals?month=${shiftMonth(month, -1)}`} className={cn(buttonClass.secondary, buttonClass.small)}>
              ← Previous
            </Link>
            {month < current && (
              <Link href={`/dashboard/${slug}/goals?month=${shiftMonth(month, 1)}`} className={cn(buttonClass.secondary, buttonClass.small)}>
                Next →
              </Link>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          label="Sales month-to-date"
          value={money(mtdSales)}
          sub={goal?.salesTarget ? `Target ${money(goal.salesTarget)}` : "No target set"}
        />
        <Kpi label="Projected month end" value={money(projected)} sub={goal?.salesTarget ? `${pct(projected / goal.salesTarget, 0)} of target` : undefined} />
        <Kpi
          label="Ad spend vs budget"
          value={money(mtd.cost)}
          sub={goal?.spendBudget ? `Budget ${money(goal.spendBudget)} · projected ${money(projectedSpend)}` : "No budget set"}
        />
        <Kpi label="ACOS" value={pct(acos(mtd))} sub={goal?.acosTarget ? `Target ${pct(goal.acosTarget)}` : "No target set"} />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <PaceBar label="Sales pacing" value={salesPace} goodAbove />
        <PaceBar label="Spend pacing" value={spendPace} />
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Cumulative sales vs target"
          right={
            <Legend
              items={[
                { label: "Actual", color: "var(--color-series-sales)" },
                { label: "Projected", color: "var(--color-series-sales)", dashed: true },
                { label: "Target pace", color: "#f8a42e", dashed: true },
              ]}
            />
          }
        />
        <div className="px-3 pt-5 pb-4">
          <PaceChart data={chart} />
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title={`Set ${monthLabel} targets`} />
        <GoalForm brand={slug} month={month} goal={goal} />
      </Card>
    </>
  );
}

function PaceBar({ label, value, goodAbove = false }: { label: string; value: number | null; goodAbove?: boolean }) {
  const v = value ?? 0;
  const ok = goodAbove ? v >= 0.97 : v <= 1.03;
  const close = goodAbove ? v >= 0.85 : v <= 1.15;
  const tone = value == null ? "brand" : ok ? "good" : close ? "brand" : "bad";
  return (
    <Card className="px-6 py-5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-bold text-ink">{label}</span>
        <span className={cn("font-bold tabular", value == null ? "text-faint" : { good: "text-good", brand: "text-brand-ink", bad: "text-bad" }[tone])}>
          {value == null ? "Set a target" : `${pct(v, 0)} of expected`}
        </span>
      </div>
      <div className="relative mt-3">
        <Progress value={v / 1.5} tone={tone} />
        <div className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-navy-800" style={{ left: "66.7%" }} title="On pace" />
      </div>
      <div className="relative mt-2 h-4 text-[11px] font-semibold text-faint">
        <span className="absolute -translate-x-1/2" style={{ left: "66.7%" }}>
          On pace
        </span>
      </div>
    </Card>
  );
}
