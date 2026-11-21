import Link from "next/link";
import { Card, CardHeader, Kpi, PageHeader, Segmented } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { MOVER_TOTALS } from "@/lib/table-totals";
import { data, ACTION_CATEGORIES } from "@/lib/data";
import { shortDate } from "@/lib/dates";
import { money, pct } from "@/lib/format";
import { acos, change, cpc, ctr, cvr, sum, type Totals } from "@/lib/metrics";
import { salesDriver } from "@/lib/insights";
import { brandRange, getBrandOr404, param, type BrandParams, type SearchParams } from "@/lib/page";

const ZERO: Totals = { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, units: 0 };
const DRIVER_TONES = { Traffic: "info", Conversion: "warn", "Order value": "neutral", Paused: "bad", New: "good", Flat: "neutral" };

export default async function WhatChangedPage({ params, searchParams }: { params: BrandParams; searchParams: SearchParams }) {
  const { brand: slug } = await params;
  const sp = await searchParams;
  const brand = await getBrandOr404(slug, "what_changed");
  const days = [7, 14, 30].includes(Number(param(sp, "range"))) ? Number(param(sp, "range")) : 7;
  const range = await brandRange(slug, String(days), 7);

  const ds = data();
  const [cNow, cPrev, pNow, pPrev, actions] = await Promise.all([
    ds.campaigns(slug, range.from, range.to),
    ds.campaigns(slug, range.prevFrom, range.prevTo),
    ds.products(slug, range.from, range.to),
    ds.products(slug, range.prevFrom, range.prevTo),
    ds.actions(slug, 200),
  ]);
  const now = sum(cNow);
  const prev = sum(cPrev);
  const windowActions = actions.filter((a) => a.actionDate >= range.prevFrom && a.actionDate <= range.to);
  const catLabel = (c: string) => ACTION_CATEGORIES.find((x) => x.value === c)?.label ?? c;

  // Campaign movers: union of both periods so paused/new campaigns show up.
  const prevById = new Map(cPrev.map((c) => [c.campaignId, c]));
  const ids = new Set([...cNow.map((c) => c.campaignId), ...cPrev.map((c) => c.campaignId)]);
  const movers = [...ids].map((id) => {
    const a = cNow.find((c) => c.campaignId === id);
    const b = prevById.get(id);
    const meta = a ?? b!;
    const n = a ?? { ...ZERO };
    const p = b ?? { ...ZERO };
    const related = windowActions.find((x) => x.campaignId === id);
    return {
      name: meta.name,
      salesNow: n.sales,
      salesPrev: p.sales,
      salesChange: n.sales - p.sales,
      costNow: n.cost,
      salesDelta: change(n.sales, p.sales),
      costChange: n.cost - p.cost,
      acosNow: acos(n),
      acosPrev: acos(p),
      driver: salesDriver(n, p, meta.state),
      related: related ? `${shortDate(related.actionDate)} · ${catLabel(related.category)}` : null,
      absChange: Math.abs(n.sales - p.sales),
    };
  });

  const prodPrev = new Map(pPrev.map((p) => [p.asin, p]));
  const productMovers = pNow.map((p) => {
    const b = prodPrev.get(p.asin) ?? { ...ZERO, asin: p.asin, sku: p.sku };
    return {
      asin: p.asin,
      sku: p.sku,
      salesNow: p.sales,
      salesChange: p.sales - b.sales,
      salesPrev: b.sales,
      costNow: p.cost,
      salesDelta: change(p.sales, b.sales),
      acosNow: acos(p),
      driver: salesDriver(p, b),
      absChange: Math.abs(p.sales - b.sales),
    };
  });

  const up = movers.filter((m) => m.salesChange > 0).reduce((a, m) => a + m.salesChange, 0);
  const down = movers.filter((m) => m.salesChange < 0).reduce((a, m) => a + m.salesChange, 0);

  return (
    <>
      <PageHeader
        eyebrow="What changed"
        title="Why did sales move?"
        subtitle={`${brand.name} · ${shortDate(range.from)}–${shortDate(range.to)} vs ${shortDate(range.prevFrom)}–${shortDate(range.prevTo)}${range.pending ? ` · ${shortDate(range.pending)} report pending` : ""}`}
        right={
          <Segmented
            items={[7, 14, 30].map((d) => ({
              href: `/dashboard/${slug}/what-changed?range=${d}`,
              label: d === 7 ? "Week over week" : `${d}D vs prior`,
              active: d === days,
            }))}
          />
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi size="sm" label="Ad sales" value={money(now.sales)} delta={change(now.sales, prev.sales)} />
        <Kpi size="sm" label="Spend" value={money(now.cost)} delta={change(now.cost, prev.cost)} invert />
        <Kpi size="sm" label="ACOS" value={pct(acos(now))} delta={change(acos(now), acos(prev))} invert />
        <Kpi size="sm" label="Clicks" value={now.clicks.toLocaleString()} delta={change(now.clicks, prev.clicks)} />
        <Kpi size="sm" label="CPC" value={money(cpc(now), 2)} delta={change(cpc(now), cpc(prev))} invert />
        <Kpi size="sm" label="CVR" value={pct(cvr(now))} delta={change(cvr(now), cvr(prev))} sub={`CTR ${pct(ctr(now), 2)}`} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Card className="px-6 py-5">
          <div className="text-sm font-semibold text-muted">Gained</div>
          <div className="mt-2 font-display text-[26px] leading-none font-bold text-good tabular">+{money(up)}</div>
          <div className="mt-2 text-xs text-muted">from {movers.filter((m) => m.salesChange > 0).length} campaigns that grew</div>
        </Card>
        <Card className="px-6 py-5">
          <div className="text-sm font-semibold text-muted">Lost</div>
          <div className="mt-2 font-display text-[26px] leading-none font-bold text-bad tabular">{money(down)}</div>
          <div className="mt-2 text-xs text-muted">from {movers.filter((m) => m.salesChange < 0).length} campaigns that shrank</div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Campaign movers" right={<span className="text-xs text-muted">Driver = biggest of traffic, conversion rate, order value</span>} />
        <DataTable
          defaultSort={{ key: "absChange", dir: "desc" }}
          pageSize={15}
          totals={MOVER_TOTALS}
          exportName={`${slug}-campaign-movers-${range.from}-${range.to}`}
          searchKeys={["name"]}
          columns={[
            { key: "name", label: "Campaign", width: "30%" },
            { key: "salesPrev", label: "Sales before", format: "money" },
            { key: "salesNow", label: "Sales now", format: "money" },
            { key: "salesChange", label: "Change", format: "money" },
            { key: "salesDelta", label: "Δ %", format: "delta", tone: "up" },
            { key: "acosNow", label: "ACOS", format: "pct" },
            { key: "driver", label: "Driver", badge: DRIVER_TONES },
            { key: "related", label: "Logged action" },
          ]}
          rows={movers}
        />
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Product movers" />
          <DataTable
            defaultSort={{ key: "absChange", dir: "desc" }}
            pageSize={10}
            searchKeys={["asin", "sku"]}
            totals={MOVER_TOTALS}
            exportName={`${slug}-product-movers-${range.from}-${range.to}`}
            columns={[
              { key: "asin", label: "ASIN" },
              { key: "sku", label: "SKU" },
              { key: "salesNow", label: "Ad sales", format: "money" },
              { key: "salesChange", label: "Change", format: "money" },
              { key: "salesDelta", label: "Δ %", format: "delta", tone: "up" },
              { key: "acosNow", label: "ACOS", format: "pct" },
              { key: "driver", label: "Driver", badge: DRIVER_TONES },
            ]}
            rows={productMovers}
          />
        </Card>
        <Card>
          <CardHeader
            title="Actions in this window"
            right={
              <Link href={`/dashboard/${slug}/actions`} className="text-xs font-semibold text-brand-ink hover:underline">
                Action log →
              </Link>
            }
          />
          <ul className="divide-y divide-line">
            {windowActions.length === 0 && <li className="px-6 py-6 text-sm text-muted">No actions logged in these dates.</li>}
            {windowActions.map((a) => (
              <li key={a.id} className="px-6 py-3.5">
                <div className="text-xs text-muted">
                  {shortDate(a.actionDate)} · {catLabel(a.category)}
                </div>
                <div className="mt-0.5 text-sm font-semibold text-ink">{a.description}</div>
                {a.campaignName && <div className="truncate text-xs text-faint">{a.campaignName}</div>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
