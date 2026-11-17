import Link from "next/link";
import { Card, CardHeader, Kpi, PageHeader, cn } from "@/components/ui";
import { HourlyChart, Legend } from "@/components/charts";
import { DataTable } from "@/components/data-table";
import { data } from "@/lib/data";
import { addDays, shortDate, todayUtc } from "@/lib/dates";
import { money, pct } from "@/lib/format";
import { getBrandOr404, param, type BrandParams, type SearchParams } from "@/lib/page";

export default async function HourlyPage({ params, searchParams }: { params: BrandParams; searchParams: SearchParams }) {
  const { brand: slug } = await params;
  const sp = await searchParams;
  const brand = await getBrandOr404(slug);
  const today = todayUtc();
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, -i));
  const day = days.includes(param(sp, "day") ?? "") ? param(sp, "day")! : today;

  const ds = data();
  const prior = Array.from({ length: 7 }, (_, i) => addDays(day, -(i + 1)));
  const [hours, ...history] = await Promise.all([ds.hourly(slug, day), ...prior.map((d) => ds.hourly(slug, d))]);
  const avg = (h: number, key: "sales" | "cost") => history.reduce((a, d) => a + (d[h]?.[key] ?? 0), 0) / history.length;

  const total = hours.reduce(
    (a, h) => ({ cost: a.cost + h.cost, sales: a.sales + h.sales, clicks: a.clicks + h.clicks, orders: a.orders + h.orders }),
    { cost: 0, sales: 0, clicks: 0, orders: 0 },
  );
  const active = hours.filter((h) => h.cost > 0);
  const best = [...active].sort((a, b) => b.sales / (b.cost || 1) - a.sales / (a.cost || 1))[0];
  const worst = [...active].filter((h) => h.cost > total.cost / 48).sort((a, b) => a.sales / (a.cost || 1) - b.sales / (b.cost || 1))[0];
  const label = (h: number) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`);

  return (
    <>
      <PageHeader
        eyebrow="Marketing Stream"
        title="Hourly"
        subtitle={`${brand.name} · hour-by-hour spend and sales in the marketplace's local time`}
        right={
          <div className="flex flex-wrap gap-1">
            {days.map((d) => (
              <Link
                key={d}
                href={`/dashboard/${slug}/hourly?day=${d}`}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium",
                  d === day ? "border-ink bg-ink text-white" : "border-line bg-surface text-muted hover:text-ink",
                )}
              >
                {d === today ? "Today" : shortDate(d)}
              </Link>
            ))}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Spend" value={money(total.cost)} />
        <Kpi label="Sales" value={money(total.sales)} />
        <Kpi label="ACOS" value={pct(total.sales ? total.cost / total.sales : null)} />
        <Kpi label="Best hour" value={best ? label(best.hour) : "—"} sub={best ? `ROAS ${(best.sales / best.cost).toFixed(2)}` : undefined} />
        <Kpi label="Weakest hour" value={worst ? label(worst.hour) : "—"} sub={worst ? `ROAS ${(worst.sales / worst.cost).toFixed(2)}` : undefined} />
      </div>
      <Card className="mt-6">
        <CardHeader
          title={`Spend & sales by hour · ${day === today ? "today (so far)" : shortDate(day)}`}
          right={
            <Legend
              items={[
                { label: "Sales", color: "var(--color-series-sales)" },
                { label: "Spend", color: "var(--color-series-spend)" },
                { label: "7-day avg sales", color: "#0f172a", dashed: true },
              ]}
            />
          }
        />
        <div className="px-3 pb-4">
          <HourlyChart data={hours.map((h) => ({ hour: h.hour, cost: h.cost, sales: h.sales, avgSales: avg(h.hour, "sales") }))} />
        </div>
      </Card>
      <Card className="mt-4">
        <DataTable
          defaultSort={{ key: "hour", dir: "asc" }}
          pageSize={24}
          exportName={`${slug}-hourly-${day}`}
          columns={[
            { key: "label", label: "Hour" },
            { key: "impressions", label: "Impr.", format: "int" },
            { key: "clicks", label: "Clicks", format: "int" },
            { key: "cost", label: "Spend", format: "money2" },
            { key: "avgCost", label: "7d avg spend", format: "money2" },
            { key: "orders", label: "Orders", format: "int" },
            { key: "sales", label: "Sales", format: "money2" },
            { key: "avgSales", label: "7d avg sales", format: "money2" },
            { key: "acos", label: "ACOS", format: "pct" },
          ]}
          rows={hours.map((h) => ({
            ...h,
            label: label(h.hour),
            avgCost: avg(h.hour, "cost"),
            avgSales: avg(h.hour, "sales"),
            acos: h.sales ? h.cost / h.sales : null,
          }))}
        />
      </Card>
    </>
  );
}
