import { Card, Kpi, PageHeader, Tabs } from "@/components/ui";
import { RangePicker } from "@/components/date-range";
import { rangeParams } from "@/lib/dates";
import { DataTable } from "@/components/data-table";
import { data } from "@/lib/data";
import { money, pct } from "@/lib/format";
import { acos, sum, withRatios } from "@/lib/metrics";
import { brandRange, customParams, getBrandOr404, param, rangeLabel, type BrandParams, type SearchParams } from "@/lib/page";

const VIEWS = {
  all: { label: "All terms", test: () => true },
  wasted: { label: "Wasted spend", test: (r: { clicks: number; orders: number }) => r.clicks >= 10 && r.orders === 0 },
  winners: { label: "Winners", test: (r: { orders: number; acos: number | null }) => r.orders >= 2 && (r.acos ?? 1) < 0.25 },
  harvest: {
    label: "Harvest (auto/broad → exact)",
    test: (r: { orders: number; matchType: string | null }) => r.orders >= 2 && r.matchType !== "EXACT",
  },
} as const;
type View = keyof typeof VIEWS;

export default async function SearchTermsPage({ params, searchParams }: { params: BrandParams; searchParams: SearchParams }) {
  const { brand: slug } = await params;
  const sp = await searchParams;
  const brand = await getBrandOr404(slug);
  const range = await brandRange(slug, param(sp, "range"), 30, customParams(sp));
  const view = (param(sp, "view") ?? "all") as View;
  const active = VIEWS[view] ? view : "all";

  const terms = (await data().searchTerms(slug, range.from, range.to)).map((t) => withRatios(t));
  const rows = terms.filter((r) => (VIEWS[active].test as (r: (typeof terms)[number]) => boolean)(r));
  const wasted = sum(terms.filter(VIEWS.wasted.test));
  const all = sum(terms);
  const base = `/dashboard/${slug}/search-terms`;

  return (
    <>
      <PageHeader
        eyebrow="Ads analytics"
        title="Search terms"
        subtitle={`${brand.name} · Sponsored Products · ${rangeLabel(range)}`}
        right={<RangePicker basePath={base} range={range} maxDate={range.through} extra={{ view: active }} />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Search terms" value={terms.length.toLocaleString()} />
        <Kpi label="Spend" value={money(all.cost)} sub={`ACOS ${pct(acos(all))}`} />
        <Kpi label="Wasted spend" value={money(wasted.cost)} sub={`${pct(all.cost ? wasted.cost / all.cost : null)} of spend · 10+ clicks, 0 orders`} />
        <Kpi label="Terms with orders" value={terms.filter((t) => t.orders > 0).length.toLocaleString()} />
      </div>
      <Card className="mt-6">
        <Tabs
          items={(Object.keys(VIEWS) as View[]).map((k) => ({
            href: `${base}?${new URLSearchParams({ ...rangeParams(range), view: k })}`,
            label: VIEWS[k].label,
            active: active === k,
            count: terms.filter((r) => (VIEWS[k].test as (r: (typeof terms)[number]) => boolean)(r)).length,
          }))}
        />
        <DataTable
          searchKeys={["searchTerm", "targeting", "campaignName"]}
          exportName={`${slug}-search-terms-${active}-${range.from}-${range.to}`}
          defaultSort={{ key: "cost", dir: "desc" }}
          columns={[
            { key: "searchTerm", label: "Search term", width: "22%" },
            { key: "targeting", label: "Targeting" },
            { key: "matchType", label: "Match" },
            { key: "campaignName", label: "Campaign" },
            { key: "impressions", label: "Impr.", format: "int" },
            { key: "clicks", label: "Clicks", format: "int" },
            { key: "cost", label: "Spend", format: "money2" },
            { key: "orders", label: "Orders", format: "int" },
            { key: "sales", label: "Sales", format: "money" },
            { key: "acos", label: "ACOS", format: "pct" },
            { key: "cvr", label: "CVR", format: "pct" },
          ]}
          rows={rows.map((r) => ({ ...r, matchType: r.matchType?.replace("TARGETING_EXPRESSION_PREDEFINED", "AUTO") ?? null }))}
        />
      </Card>
    </>
  );
}
