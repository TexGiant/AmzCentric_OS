import { cookies } from "next/headers";
import { Card, CardHeader, Kpi, PageHeader, Segmented } from "@/components/ui";
import { Legend, SalesSpendChart } from "@/components/charts";
import { DataTable, type Column } from "@/components/data-table";
import { RangePicker } from "@/components/date-range";
import { WeekStartSelect } from "@/components/week-start";
import { data } from "@/lib/data";
import { addDays, customRange, daysBetween } from "@/lib/dates";
import { money, pct } from "@/lib/format";
import { change, sum } from "@/lib/metrics";
import { brandClock, getBrandOr404, param, type BrandParams, type SearchParams } from "@/lib/page";
import {
  DEFAULT_COUNT,
  DEFAULT_WEEK_START,
  PERIOD_PRESETS,
  PERIODS,
  PRESET_UNIT,
  WEEKDAYS,
  WEEK_START_COOKIE,
  buckets,
  buildReport,
  reportMetrics,
  reportWindow,
  type Period,
} from "@/lib/report";

const SP = "SP-API";

export default async function ReportsPage({ params, searchParams }: { params: BrandParams; searchParams: SearchParams }) {
  const { brand: slug } = await params;
  const sp = await searchParams;
  const brand = await getBrandOr404(slug, "reports");
  const clock = await brandClock(slug);
  const through = clock.through;

  const period: Period = PERIODS.some((p) => p.key === param(sp, "period")) ? (param(sp, "period") as Period) : "weekly";
  const wsRaw = param(sp, "ws") ?? (await cookies()).get(WEEK_START_COOKIE)?.value;
  const ws = wsRaw != null && /^[0-6]$/.test(wsRaw) ? Number(wsRaw) : DEFAULT_WEEK_START;
  const nRaw = Number(param(sp, "n"));
  const count = PERIOD_PRESETS[period].includes(nRaw) ? nRaw : DEFAULT_COUNT[period];

  const custom = customRange(param(sp, "from"), param(sp, "to"), through);
  const win = custom ? { from: custom.from, to: custom.to } : reportWindow(period, count, through, ws);
  const bs = buckets(period, win.from, win.to, ws);
  const days = daysBetween(win.from, win.to) + 1;
  const prevTo = addDays(win.from, -1);
  const prevFrom = addDays(win.from, -days);

  const daily = await data().brandDaily(slug, prevFrom, win.to);
  const report = buildReport(
    period,
    daily.filter((d) => d.date >= win.from),
    bs,
    through,
  );
  const prevDaily = daily.filter((d) => d.date <= prevTo);
  const prevComplete = prevDaily.length === days && prevDaily.every((d) => d.totalSales != null && d.totalOrders != null);
  const prev = reportMetrics(sum(prevDaily), prevComplete);
  const t = report.total;
  const hasSpApi = t.totalSales != null;

  const base = `/dashboard/${slug}/reports`;
  const keep = { period, ws: String(ws) };
  const unitWord = period === "daily" ? "days" : period === "weekly" ? "weeks" : "months";

  const columns: Column[] = [
    { key: "label", label: period === "daily" ? "Day" : period === "weekly" ? "Week" : "Month", sortKey: "start", nowrap: true },
    ...(period === "daily"
      ? []
      : [
          { key: "startLabel", label: "Start", sortKey: "start", nowrap: true },
          { key: "endLabel", label: "End", sortKey: "end", nowrap: true },
        ]),
    { key: "totalOrders", label: "Total orders", format: "int", tag: SP },
    { key: "ppcOrders", label: "PPC orders", format: "int" },
    { key: "organicOrders", label: "Organic orders", format: "int", tag: SP },
    { key: "totalSales", label: "Total sales", format: "money2", tag: SP },
    { key: "ppcSales", label: "PPC sales", format: "money2" },
    { key: "ppcSpend", label: "PPC spend", format: "money2" },
    { key: "clicks", label: "Clicks", format: "int" },
    { key: "organicRatio", label: "Organic ratio", format: "pct", tag: SP },
    { key: "ppcRatio", label: "PPC ratio", format: "pct", tag: SP },
    { key: "tacos", label: "TACOS", format: "pct", tag: SP },
    { key: "acos", label: "ACOS", format: "pct" },
    { key: "cpc", label: "Avg CPC", format: "money2" },
    { key: "cvr", label: "PPC CVR", format: "pct" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title={`${PERIODS.find((p) => p.key === period)!.label} report`}
        subtitle={`${brand.name} · ${report.rows.length} ${unitWord} · data through ${through}${clock.pending ? " (latest report pending)" : ""}`}
        right={
          <Segmented
            items={PERIODS.map((p) => ({
              href: `${base}?${new URLSearchParams({ period: p.key, ws: String(ws) })}`,
              label: p.label,
              active: p.key === period,
            }))}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <RangePicker
          basePath={base}
          range={{ days, from: win.from, to: win.to, custom: !!custom }}
          maxDate={through}
          extra={keep}
          presets={PERIOD_PRESETS[period].map((n) => ({
            label: `${n}${PRESET_UNIT[period]}`,
            href: `${base}?${new URLSearchParams({ ...keep, n: String(n) })}`,
            active: !custom && n === count,
          }))}
        />
        {period === "weekly" && <WeekStartSelect value={ws} cookie={WEEK_START_COOKIE} />}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi size="sm" label="Total sales" value={t.totalSales == null ? "—" : money(t.totalSales)} delta={change(t.totalSales, prev.totalSales)} sub={hasSpApi ? undefined : "Needs SP-API"} />
        <Kpi size="sm" label="PPC sales" value={money(t.ppcSales)} delta={change(t.ppcSales, prev.ppcSales)} />
        <Kpi size="sm" label="PPC spend" value={money(t.ppcSpend)} delta={change(t.ppcSpend, prev.ppcSpend)} invert />
        <Kpi size="sm" label="ACOS" value={pct(t.acos)} delta={change(t.acos, prev.acos)} invert />
        <Kpi size="sm" label="TACOS" value={pct(t.tacos)} delta={change(t.tacos, prev.tacos)} invert sub={hasSpApi ? undefined : "Needs SP-API"} />
        <Kpi size="sm" label="PPC orders" value={t.ppcOrders.toLocaleString()} delta={change(t.ppcOrders, prev.ppcOrders)} sub={t.totalOrders == null ? undefined : `of ${t.totalOrders.toLocaleString()} total`} />
        <Kpi size="sm" label="Avg CPC" value={money(t.cpc, 2)} delta={change(t.cpc, prev.cpc)} invert />
        <Kpi size="sm" label="PPC CVR" value={pct(t.cvr)} delta={change(t.cvr, prev.cvr)} />
      </div>

      <Card className="mt-4">
        <CardHeader
          title={`PPC sales vs spend by ${period === "daily" ? "day" : period === "weekly" ? "week" : "month"}`}
          sub={`Changes compare with the ${days} days before ${custom ? "this range" : `these ${report.rows.length} ${unitWord}`}`}
          right={
            <Legend
              items={[
                { label: "PPC sales", color: "#000f22" },
                { label: "PPC spend", color: "#f8a42e" },
              ]}
            />
          }
        />
        <div className="px-4 pt-4 pb-2">
          <SalesSpendChart data={report.rows.map((r) => ({ date: r.start, sales: r.ppcSales, cost: r.ppcSpend }))} salesLabel="PPC sales" />
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Report"
          sub={
            hasSpApi
              ? `${period === "weekly" ? `Weeks run ${WEEKDAYS[ws]}–${WEEKDAYS[(ws + 6) % 7]}. ` : ""}Organic = total − PPC orders.`
              : `${period === "weekly" ? `Weeks run ${WEEKDAYS[ws]}–${WEEKDAYS[(ws + 6) % 7]}. ` : ""}Columns tagged SP-API fill in once Seller Central is connected.`
          }
        />
        <DataTable
          columns={columns}
          rows={report.rows}
          defaultSort={{ key: "label", dir: "desc" }}
          pageSize={100}
          exportName={`${slug}-${period}-report-${win.from}-${win.to}`}
          totals={{
            label: "Total",
            sum: ["totalOrders", "ppcOrders", "organicOrders", "totalSales", "ppcSales", "ppcSpend", "clicks"],
            // SP-API totals only when every period has them (a half-loaded period isn't a total).
            strict: ["totalOrders", "organicOrders", "totalSales"],
            ratio: {
              organicRatio: ["organicOrders", "totalOrders"],
              ppcRatio: ["ppcOrders", "totalOrders"],
              tacos: ["ppcSpend", "totalSales"],
              acos: ["ppcSpend", "ppcSales"],
              cpc: ["ppcSpend", "clicks"],
              cvr: ["ppcOrders", "clicks"],
            },
          }}
        />
      </Card>
    </>
  );
}
