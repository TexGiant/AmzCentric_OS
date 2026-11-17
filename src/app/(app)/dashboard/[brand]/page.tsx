import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardHeader, Kpi, PageHeader, Pill } from "@/components/ui";
import { Legend, SalesSpendChart } from "@/components/charts";
import { DataTable } from "@/components/data-table";
import { data } from "@/lib/data";
import { addDays, daysInMonth, monthStart, shortDate, todayUtc } from "@/lib/dates";
import { money, pct } from "@/lib/format";
import { acos, change, sum, tacos, type Totals } from "@/lib/metrics";
import { attentionItems, type Insight } from "@/lib/insights";
import { getBrandOr404, type BrandParams } from "@/lib/page";

export default async function BrandOverview({ params }: { params: BrandParams }) {
  const { brand: slug } = await params;
  const brand = await getBrandOr404(slug);
  const ds = data();

  const today = todayUtc();
  const to = addDays(today, -1);
  const from = addDays(to, -59);
  const month = monthStart(to);

  const [daily, status, hourlyToday, hourlyYesterday, campaignsNow, campaignsPrev, goal, actions] = await Promise.all([
    ds.brandDaily(slug, from, to),
    ds.brandStatus(slug),
    ds.hourly(slug, today),
    ds.hourly(slug, to),
    ds.campaigns(slug, addDays(to, -6), to),
    ds.campaigns(slug, addDays(to, -13), addDays(to, -7)),
    ds.goal(slug, month),
    ds.actions(slug, 50),
  ]);

  const win = (days: number, offset = 0) => sum(daily.slice(daily.length - days - offset, daily.length - offset));
  const nowHour = new Date().getUTCHours();
  const live = sum(hourlyToday.map((h) => ({ ...h, units: 0 })));
  const liveCompare = sum(hourlyYesterday.filter((h) => h.hour <= nowHour).map((h) => ({ ...h, units: 0 })));

  const cards: Array<{ label: string; now: Totals; prev: Totals; live?: boolean }> = [
    { label: "Today", now: live, prev: liveCompare, live: true },
    { label: "Yesterday", now: win(1), prev: win(1, 7) },
    { label: "7 days", now: win(7), prev: win(7, 7) },
    { label: "14 days", now: win(14), prev: win(14, 14) },
    { label: "30 days", now: win(30), prev: win(30, 30) },
  ];

  const mtd = sum(daily.filter((d) => d.date >= month));
  const insights = attentionItems({
    daily,
    campaignsNow,
    campaignsPrev,
    goal,
    monthToDate: mtd,
    dayOfMonth: Number(to.slice(8, 10)),
    daysInMonth: daysInMonth(to),
  });

  const chartFrom = addDays(to, -29);
  const markers = actions
    .filter((a) => a.actionDate >= chartFrom && a.actionDate <= to)
    .slice(0, 4)
    .map((a) => ({ date: a.actionDate, label: a.category }));
  const hasTotal = daily.some((d) => d.totalSales != null);

  return (
    <>
      <PageHeader
        eyebrow="Client workspace"
        title={brand.name}
        right={
          <>
            <Pill dot tone={status.profiles ? "good" : "bad"}>
              Ads: {status.profiles ? `${status.profiles} profile${status.profiles === 1 ? "" : "s"}` : "not connected"}
            </Pill>
            <Pill dot tone={status.streamLastHour ? "good" : "warn"}>
              Stream: {status.streamLastHour ? `live · ${timeAgo(status.streamLastHour)}` : "no data"}
            </Pill>
            <Pill dot tone={status.spApiConnected ? "good" : "neutral"}>
              Seller Central: {status.spApiConnected ? "connected" : "pending"}
            </Pill>
            <Pill>Data through {status.dataThrough ? shortDate(status.dataThrough) : "—"}</Pill>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <Kpi
            key={c.label}
            label={c.label}
            highlight={c.live}
            badge={c.live ? <span className="rounded bg-good-soft px-1.5 py-0.5 text-[10px] text-good">LIVE</span> : undefined}
            value={money(c.now.sales)}
            sub={
              <>
                Spend {money(c.now.cost)} · ACOS {pct(acos(c.now))}
                {!c.live && hasTotal && <> · TACOS {pct(tacos(c.now))}</>}
              </>
            }
            delta={change(c.now.sales, c.prev.sales)}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-faint">
        Big number = ad-attributed sales. &ldquo;Today&rdquo; is hourly Marketing Stream data compared with yesterday at the same hour.
      </p>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Performance trend · 30 days"
            right={
              <Legend
                items={[
                  { label: hasTotal ? "Total sales" : "Ad sales", color: "var(--color-series-sales)" },
                  { label: "Ad spend", color: "var(--color-series-spend)" },
                ]}
              />
            }
          />
          <div className="px-3 pb-4">
            <SalesSpendChart
              data={daily.slice(-30)}
              salesKey={hasTotal ? "totalSales" : "sales"}
              salesLabel={hasTotal ? "Total sales" : "Ad sales"}
              markers={markers}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title={`Attention required (${insights.filter((i) => i.tone !== "good").length})`} />
          <ul className="divide-y divide-line">
            {insights.length === 0 && (
              <li className="flex items-center gap-3 px-5 py-4 text-sm text-muted">
                <CheckCircle2 className="size-5 text-good" strokeWidth={1.5} /> Nothing unusual this week.
              </li>
            )}
            {insights.map((i, idx) => (
              <li key={idx} className="flex items-start gap-3 px-5 py-3.5">
                <InsightIcon insight={i} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{i.title}</div>
                  <div className="truncate text-xs text-muted">{i.detail}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-5 py-3 text-xs">
            <Link href={`/dashboard/${slug}/what-changed`} className="font-medium text-brand hover:underline">
              See what changed →
            </Link>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Top campaigns · last 7 days"
          right={
            <Link href={`/dashboard/${slug}/campaigns?range=7`} className="text-xs font-medium text-brand hover:underline">
              All campaigns →
            </Link>
          }
        />
        <DataTable
          defaultSort={{ key: "cost", dir: "desc" }}
          pageSize={8}
          columns={[
            { key: "name", label: "Campaign" },
            { key: "adProduct", label: "Type", badge: { SP: "brand", SB: "warn", SD: "neutral" } },
            { key: "cost", label: "Spend", format: "money" },
            { key: "sales", label: "Sales", format: "money" },
            { key: "acos", label: "ACOS", format: "pct" },
            { key: "acosDelta", label: "Δ ACOS", format: "delta", tone: "down" },
            { key: "orders", label: "Orders", format: "int" },
          ]}
          rows={campaignsNow.map((c) => {
            const p = campaignsPrev.find((x) => x.campaignId === c.campaignId);
            return { ...c, acos: acos(c), acosDelta: p ? change(acos(c), acos(p)) : null };
          })}
        />
      </Card>
    </>
  );
}

function InsightIcon({ insight }: { insight: Insight }) {
  const cls = "mt-0.5 size-8 shrink-0 rounded-lg p-1.5";
  if (insight.tone === "good") return <TrendingUp className={`${cls} bg-good-soft text-good`} strokeWidth={1.5} />;
  if (insight.kind === "acos") return <TrendingUp className={`${cls} bg-bad-soft text-bad`} strokeWidth={1.5} />;
  if (insight.kind === "cvr") return <TrendingDown className={`${cls} bg-warn-soft text-warn`} strokeWidth={1.5} />;
  if (insight.kind === "pace") return <Clock className={`${cls} bg-brand-soft text-brand`} strokeWidth={1.5} />;
  return <AlertTriangle className={`${cls} bg-warn-soft text-warn`} strokeWidth={1.5} />;
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 90) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
