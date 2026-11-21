import { Card, Kpi, PageHeader, Tabs } from "@/components/ui";
import { RangePicker } from "@/components/date-range";
import { rangeParams } from "@/lib/dates";
import { DataTable } from "@/components/data-table";
import { data } from "@/lib/data";
import { money, pct } from "@/lib/format";
import { acos, change, cpc, ctr, cvr, roas, sum, withRatios } from "@/lib/metrics";
import { brandRange, customParams, getBrandOr404, param, rangeLabel, type BrandParams, type SearchParams } from "@/lib/page";

export default async function CampaignsPage({ params, searchParams }: { params: BrandParams; searchParams: SearchParams }) {
  const { brand: slug } = await params;
  const sp = await searchParams;
  const brand = await getBrandOr404(slug, "campaigns");
  const range = await brandRange(slug, param(sp, "range"), 30, customParams(sp));
  const type = param(sp, "type") ?? "all";

  const [now, prev] = await Promise.all([
    data().campaigns(slug, range.from, range.to),
    data().campaigns(slug, range.prevFrom, range.prevTo),
  ]);
  const prevById = new Map(prev.map((c) => [c.campaignId, c]));
  const filtered = type === "all" ? now : now.filter((c) => c.adProduct === type);
  const t = sum(filtered);
  const tp = sum(type === "all" ? prev : prev.filter((c) => c.adProduct === type));
  const base = `/dashboard/${slug}/campaigns`;

  return (
    <>
      <PageHeader
        eyebrow="Ads analytics"
        title="Campaign manager"
        subtitle={`${brand.name} · ${rangeLabel(range)}`}
        right={<RangePicker basePath={base} range={range} maxDate={range.through} extra={{ type }} />}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        <Kpi size="sm" label="Spend" value={money(t.cost)} delta={change(t.cost, tp.cost)} invert />
        <Kpi size="sm" label="Sales" value={money(t.sales)} delta={change(t.sales, tp.sales)} />
        <Kpi size="sm" label="ACOS" value={pct(acos(t))} delta={change(acos(t), acos(tp))} invert />
        <Kpi size="sm" label="ROAS" value={roas(t)?.toFixed(2) ?? "—"} delta={change(roas(t), roas(tp))} />
        <Kpi size="sm" label="CPC" value={money(cpc(t), 2)} delta={change(cpc(t), cpc(tp))} invert />
        <Kpi size="sm" label="CTR" value={pct(ctr(t), 2)} delta={change(ctr(t), ctr(tp))} />
        <Kpi size="sm" label="CVR" value={pct(cvr(t))} delta={change(cvr(t), cvr(tp))} />
      </div>
      <Card className="mt-6">
        <Tabs
          items={["all", "SP", "SB", "SD"].map((k) => ({
            href: `${base}?${new URLSearchParams({ ...rangeParams(range), type: k })}`,
            label: k === "all" ? "All" : k === "SP" ? "Sponsored Products" : k === "SB" ? "Sponsored Brands" : "Sponsored Display",
            active: type === k,
            count: k === "all" ? now.length : now.filter((c) => c.adProduct === k).length,
          }))}
        />
        <DataTable
          searchKeys={["name"]}
          exportName={`${slug}-campaigns-${range.from}-${range.to}`}
          defaultSort={{ key: "cost", dir: "desc" }}
          columns={[
            { key: "name", label: "Campaign", width: "30%" },
            { key: "adProduct", label: "Type", badge: { SP: "brand", SB: "info", SD: "neutral" } },
            { key: "state", label: "State", badge: { enabled: "good", paused: "neutral", archived: "neutral" } },
            { key: "budget", label: "Budget", format: "money" },
            { key: "impressions", label: "Impr.", format: "int" },
            { key: "clicks", label: "Clicks", format: "int" },
            { key: "ctr", label: "CTR", format: "pct" },
            { key: "cost", label: "Spend", format: "money" },
            { key: "cpc", label: "CPC", format: "money2" },
            { key: "orders", label: "Orders", format: "int" },
            { key: "sales", label: "Sales", format: "money" },
            { key: "salesDelta", label: "Δ Sales", format: "delta", tone: "up" },
            { key: "acos", label: "ACOS", format: "pct" },
            { key: "cvr", label: "CVR", format: "pct" },
          ]}
          rows={filtered.map((c) => ({
            ...withRatios(c),
            name: c.name,
            adProduct: c.adProduct,
            state: c.state,
            budget: c.budget,
            salesDelta: change(c.sales, prevById.get(c.campaignId)?.sales),
          }))}
        />
      </Card>
    </>
  );
}
