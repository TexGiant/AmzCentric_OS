import { Card, Kpi, PageHeader } from "@/components/ui";
import { RangePicker } from "@/components/date-range";
import { DataTable } from "@/components/data-table";
import { data } from "@/lib/data";
import { money, pct } from "@/lib/format";
import { acos, change, sum, withRatios } from "@/lib/metrics";
import { brandRange, customParams, getBrandOr404, param, rangeLabel, type BrandParams, type SearchParams } from "@/lib/page";

export default async function ProductsPage({ params, searchParams }: { params: BrandParams; searchParams: SearchParams }) {
  const { brand: slug } = await params;
  const sp = await searchParams;
  const brand = await getBrandOr404(slug, "products");
  const range = await brandRange(slug, param(sp, "range"), 30, customParams(sp));
  const [now, prev] = await Promise.all([
    data().products(slug, range.from, range.to),
    data().products(slug, range.prevFrom, range.prevTo),
  ]);
  const prevBy = new Map(prev.map((p) => [p.asin, p]));
  const t = sum(now);
  const tp = sum(prev);

  return (
    <>
      <PageHeader
        eyebrow="Products & market"
        title="Product performance"
        subtitle={`${brand.name} · advertised ASINs (Sponsored Products) · ${rangeLabel(range)}`}
        right={<RangePicker basePath={`/dashboard/${slug}/products`} range={range} maxDate={range.through} />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Advertised ASINs" value={String(now.filter((p) => p.cost > 0).length)} />
        <Kpi label="Ad spend" value={money(t.cost)} delta={change(t.cost, tp.cost)} invert />
        <Kpi label="Ad sales" value={money(t.sales)} delta={change(t.sales, tp.sales)} />
        <Kpi label="ACOS" value={pct(acos(t))} delta={change(acos(t), acos(tp))} invert />
      </div>
      <Card className="mt-6">
        <DataTable
          searchKeys={["asin", "sku"]}
          exportName={`${slug}-products-${range.from}-${range.to}`}
          defaultSort={{ key: "sales", dir: "desc" }}
          columns={[
            { key: "asin", label: "ASIN" },
            { key: "sku", label: "SKU" },
            { key: "clicks", label: "Clicks", format: "int" },
            { key: "cost", label: "Spend", format: "money" },
            { key: "orders", label: "Orders", format: "int" },
            { key: "sales", label: "Ad sales", format: "money" },
            { key: "salesDelta", label: "Δ Sales", format: "delta", tone: "up" },
            { key: "acos", label: "ACOS", format: "pct" },
            { key: "acosDelta", label: "Δ ACOS", format: "delta", tone: "down" },
            { key: "cvr", label: "CVR", format: "pct" },
          ]}
          rows={now.map((p) => {
            const b = prevBy.get(p.asin);
            return {
              ...withRatios(p),
              asin: p.asin,
              sku: p.sku,
              salesDelta: change(p.sales, b?.sales),
              acosDelta: b ? change(acos(p), acos(b)) : null,
            };
          })}
        />
      </Card>
      <p className="mt-3 text-xs text-faint">
        Organic sales, sessions, Buy Box and Search Query Performance join this table once SP-API is connected.
      </p>
    </>
  );
}
