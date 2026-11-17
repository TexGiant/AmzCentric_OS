import Link from "next/link";
import { ArrowRight, Tags } from "lucide-react";
import { Card, CardHeader, Delta, Empty, Kpi, PageHeader, RangeTabs, buttonClass } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { data } from "@/lib/data";
import { resolveRange } from "@/lib/dates";
import { money, pct } from "@/lib/format";
import { acos, change, sum, tacos } from "@/lib/metrics";
import { param, type SearchParams } from "@/lib/page";

export default async function AllBrandsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const range = resolveRange(param(sp, "range"));
  const ds = data();
  const brands = await ds.listBrands();

  if (!brands.length) {
    return (
      <>
        <PageHeader eyebrow="Portfolio" title="All brands" />
        <Card>
          <Empty icon={<Tags className="size-8" strokeWidth={1.5} />} title="No brands yet">
            Create a brand, connect an Amazon Ads account, then assign its profiles to the brand.
            <div className="mt-4">
              <Link href="/settings/brands" className={buttonClass.primary}>
                Set up brands
              </Link>
            </div>
          </Empty>
        </Card>
      </>
    );
  }

  const rows = await Promise.all(
    brands.map(async (b) => {
      const series = await ds.brandDaily(b.slug, range.prevFrom, range.to);
      const now = sum(series.filter((d) => d.date >= range.from));
      const prev = sum(series.filter((d) => d.date < range.from));
      return { b, now, prev };
    }),
  );
  const total = sum(rows.map((r) => r.now));
  const totalPrev = sum(rows.map((r) => r.prev));

  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="All brands"
        subtitle={`${brands.length} brands · last ${range.days} days vs the ${range.days} before`}
        right={<RangeTabs basePath="/dashboard" current={range.days} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Ad spend" value={money(total.cost)} delta={change(total.cost, totalPrev.cost)} invert />
        <Kpi label="Ad sales" value={money(total.sales)} delta={change(total.sales, totalPrev.sales)} />
        <Kpi label="Total sales" value={money(total.totalSales)} delta={change(total.totalSales, totalPrev.totalSales)} />
        <Kpi label="ACOS" value={pct(acos(total))} delta={change(acos(total), acos(totalPrev))} invert />
        <Kpi label="TACOS" value={pct(tacos(total))} delta={change(tacos(total), tacos(totalPrev))} invert />
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ b, now, prev }) => (
          <Link key={b.slug} href={`/dashboard/${b.slug}?range=${range.days}`} className="group">
            <Card className="h-full p-5 transition-shadow group-hover:shadow-lg group-hover:shadow-ink/5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-ink">{b.name}</div>
                  <div className="text-xs text-muted">
                    {b.profileCount} profile{b.profileCount === 1 ? "" : "s"} · {b.countries.join(", ") || "no marketplaces"}
                  </div>
                </div>
                <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand" strokeWidth={1.5} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Mini label="Ad sales" value={money(now.sales)} delta={change(now.sales, prev.sales)} />
                <Mini label="Spend" value={money(now.cost)} delta={change(now.cost, prev.cost)} invert />
                <Mini label="ACOS" value={pct(acos(now))} delta={change(acos(now), acos(prev))} invert />
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader title="Brand comparison" />
        <DataTable
          exportName={`brands-${range.from}-${range.to}`}
          defaultSort={{ key: "cost", dir: "desc" }}
          columns={[
            { key: "name", label: "Brand" },
            { key: "cost", label: "Spend", format: "money" },
            { key: "sales", label: "Ad sales", format: "money" },
            { key: "salesDelta", label: "Δ Sales", format: "delta", tone: "up" },
            { key: "totalSales", label: "Total sales", format: "money" },
            { key: "acos", label: "ACOS", format: "pct" },
            { key: "tacos", label: "TACOS", format: "pct" },
            { key: "orders", label: "Orders", format: "int" },
          ]}
          rows={rows.map(({ b, now, prev }) => ({
            name: b.name,
            ...now,
            salesDelta: change(now.sales, prev.sales),
            acos: acos(now),
            tacos: tacos(now),
          }))}
        />
      </Card>
    </>
  );
}

function Mini({ label, value, delta, invert }: { label: string; value: string; delta: number | null; invert?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className="mt-0.5 text-[17px] font-semibold text-ink tabular">{value}</div>
      <Delta value={delta} invert={invert} />
    </div>
  );
}
