import { ChevronRight } from "lucide-react";
import { Card, CardHeader, Figure, Kpi, PageHeader, Segmented } from "@/components/ui";
import { HourlyChart, HourlyClicksChart, Legend } from "@/components/charts";
import { DataTable } from "@/components/data-table";
import { data } from "@/lib/data";
import { addDays, shortDate, todayInTz } from "@/lib/dates";
import { int, money, pct } from "@/lib/format";
import { getBrandOr404, param, type BrandParams, type SearchParams } from "@/lib/page";

const div = (a: number, b: number) => (b > 0 ? a / b : null);

export default async function HourlyPage({ params, searchParams }: { params: BrandParams; searchParams: SearchParams }) {
  const { brand: slug } = await params;
  const sp = await searchParams;
  const brand = await getBrandOr404(slug, "hourly");
  const ds = data();
  const status = await ds.brandStatus(slug);
  const today = todayInTz(status.timezone);
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, -i));
  const day = days.includes(param(sp, "day") ?? "") ? param(sp, "day")! : today;

  const prior = Array.from({ length: 7 }, (_, i) => addDays(day, -(i + 1)));
  // The 7-day average is a nice-to-have: a slow or failed day must not take the page down.
  const [hours, settled] = await Promise.all([ds.hourly(slug, day), Promise.allSettled(prior.map((d) => ds.hourly(slug, d)))]);
  const history = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const avg = (h: number, key: "sales" | "cost" | "clicks") =>
    history.length ? history.reduce((a, d) => a + (d[h]?.[key] ?? 0), 0) / history.length : 0;

  const total = hours.reduce(
    (a, h) => ({
      impressions: a.impressions + h.impressions,
      clicks: a.clicks + h.clicks,
      cost: a.cost + h.cost,
      orders: a.orders + h.orders,
      sales: a.sales + h.sales,
    }),
    { impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 },
  );
  // Best/weakest hour by ROAS — only meaningful once something has sold.
  const active = total.sales > 0 ? hours.filter((h) => h.cost > total.cost / 48) : [];
  const roas = (h: (typeof hours)[number]) => h.sales / (h.cost || 1);
  const best = [...active].sort((a, b) => roas(b) - roas(a))[0];
  const worst = [...active].sort((a, b) => roas(a) - roas(b))[0];
  const label = (h: number) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`);
  const dayLabel = day === today ? "today (so far)" : shortDate(day);

  const funnel = [
    { label: "Impressions", value: int(total.impressions) },
    { label: "Clicks", value: int(total.clicks), rate: { label: "CTR", value: pct(div(total.clicks, total.impressions), 2) } },
    { label: "Orders", value: int(total.orders), rate: { label: "CVR", value: pct(div(total.orders, total.clicks)) } },
    { label: "Sales", value: money(total.sales), rate: { label: "AOV", value: money(div(total.sales, total.orders)) } },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Marketing Stream"
        title="Hourly"
        subtitle={`${brand.name} · hour-by-hour traffic and conversions · ${status.timezone.replace("_", " ")} time`}
        right={
          <Segmented
            items={days.map((d) => ({ href: `/dashboard/${slug}/hourly?day=${d}`, label: d === today ? "Today" : shortDate(d), active: d === day }))}
          />
        }
      />

      {/* Funnel: impressions → clicks → orders → sales, with the rate between each step */}
      <Card>
        <CardHeader title={`Funnel · ${dayLabel}`} sub="Traffic to conversion, step by step" />
        <div className="grid grid-cols-2 gap-y-5 px-6 py-5 md:grid-cols-4">
          {funnel.map((f, i) => (
            <div key={f.label} className="relative flex items-center gap-3 md:pl-2">
              {i > 0 && (
                <div className="hidden w-16 shrink-0 flex-col items-center text-center md:flex">
                  <span className="text-[11px] font-bold tracking-[0.1em] text-faint uppercase">{f.rate?.label}</span>
                  <span className="mt-0.5 rounded-pill bg-gold-100 px-2 py-0.5 text-xs font-bold text-gold-800 tabular">{f.rate?.value}</span>
                  <ChevronRight className="mt-1 size-4 text-faint" strokeWidth={1.5} />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-semibold text-muted">{f.label}</div>
                <div className="mt-1.5 font-display text-[26px] leading-none font-bold tracking-[-0.01em] text-ink tabular">
                  <Figure value={f.value} />
                </div>
                {f.rate && (
                  <div className="mt-2 text-xs text-muted md:hidden">
                    {f.rate.label} <span className="font-bold text-ink-2">{f.rate.value}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi size="sm" label="Spend" value={money(total.cost)} />
        <Kpi size="sm" label="ACOS" value={pct(div(total.cost, total.sales))} />
        <Kpi size="sm" label="CPC" value={money(div(total.cost, total.clicks))} />
        <Kpi size="sm" label="ROAS" value={div(total.sales, total.cost)?.toFixed(2) ?? "—"} />
        <Kpi size="sm" label="Best hour" value={best ? label(best.hour) : "—"} sub={best ? `ROAS ${roas(best).toFixed(2)}` : "No sales yet"} />
        <Kpi size="sm" label="Weakest hour" value={worst ? label(worst.hour) : "—"} sub={worst ? `ROAS ${roas(worst).toFixed(2)}` : "No sales yet"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title={`Spend & sales by hour · ${dayLabel}`}
            right={
              <Legend
                items={[
                  { label: "Sales", color: "var(--color-series-sales)" },
                  { label: "Spend", color: "var(--color-series-spend)" },
                  { label: "7-day avg sales", color: "#2d527e", dashed: true },
                ]}
              />
            }
          />
          <div className="px-3 pt-5 pb-4">
            <HourlyChart data={hours.map((h) => ({ hour: h.hour, cost: h.cost, sales: h.sales, avgSales: avg(h.hour, "sales") }))} />
          </div>
        </Card>
        <Card>
          <CardHeader
            title={`Clicks & orders by hour · ${dayLabel}`}
            right={
              <Legend
                items={[
                  { label: "Clicks", color: "#2d527e" },
                  { label: "Orders", color: "var(--color-series-spend)" },
                  { label: "7-day avg clicks", color: "#94a3b8", dashed: true },
                ]}
              />
            }
          />
          <div className="px-3 pt-5 pb-4">
            <HourlyClicksChart data={hours.map((h) => ({ hour: h.hour, clicks: h.clicks, orders: h.orders, avgClicks: avg(h.hour, "clicks") }))} />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <DataTable
          defaultSort={{ key: "hour", dir: "asc" }}
          pageSize={24}
          exportName={`${slug}-hourly-${day}`}
          columns={[
            { key: "label", label: "Hour" },
            { key: "impressions", label: "Impr.", format: "int" },
            { key: "clicks", label: "Clicks", format: "int" },
            { key: "ctr", label: "CTR", format: "pct" },
            { key: "cost", label: "Spend", format: "money2" },
            { key: "cpc", label: "CPC", format: "money2" },
            { key: "orders", label: "Orders", format: "int" },
            { key: "cvr", label: "CVR", format: "pct" },
            { key: "sales", label: "Sales", format: "money2" },
            { key: "acos", label: "ACOS", format: "pct" },
            { key: "avgClicks", label: "7d avg clicks", format: "dec1" },
            { key: "avgSales", label: "7d avg sales", format: "money2" },
          ]}
          rows={hours.map((h) => ({
            ...h,
            label: label(h.hour),
            ctr: div(h.clicks, h.impressions),
            cpc: div(h.cost, h.clicks),
            cvr: div(h.orders, h.clicks),
            acos: div(h.cost, h.sales),
            avgClicks: avg(h.hour, "clicks"),
            avgSales: avg(h.hour, "sales"),
          }))}
        />
      </Card>
    </>
  );
}
