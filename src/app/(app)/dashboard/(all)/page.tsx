import Link from "next/link";
import { ArrowRight, Tags } from "lucide-react";
import { Card, CardHeader, Delta, Empty, Eyebrow, Figure, NavyPanel, NavyStat, PageHeader, RangeTabs, buttonClass } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { AD_TOTALS } from "@/lib/table-totals";
import { requireAccess } from "@/lib/access";
import { data } from "@/lib/data";
import { isAdmin } from "@/lib/rbac";
import { resolveRange, shortDate } from "@/lib/dates";
import { money, pct } from "@/lib/format";
import { acos, change, sum, tacos } from "@/lib/metrics";
import { brandClock, param, rangeLabel, type SearchParams } from "@/lib/page";

export default async function AllBrandsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const access = await requireAccess();
  const ds = data();
  const brands = await ds.listBrands(); // only the brands this person may see
  // One period for every brand: ends on the last day all brands have reports for.
  const clocks = await Promise.all(brands.map((b) => brandClock(b.slug)));
  const through = clocks.length ? clocks.map((c) => c.through).sort()[0] : undefined;
  const latest = clocks.length ? clocks.map((c) => c.yesterday).sort().at(-1)! : null;
  const range = { ...resolveRange(param(sp, "range"), 30, through), pending: latest && through && through < latest ? latest : null };

  if (!brands.length) {
    return (
      <>
        <PageHeader eyebrow="Portfolio" title="All brands" />
        <Card>
          {isAdmin(access) ? (
            <Empty icon={<Tags className="size-8" strokeWidth={1.5} />} title="No brands yet">
              Create a brand, connect an Amazon Ads account, then assign its profiles to the brand.
              <div className="mt-4">
                <Link href="/settings/brands" className={buttonClass.primary}>
                  Set up brands
                </Link>
              </div>
            </Empty>
          ) : (
            <Empty icon={<Tags className="size-8" strokeWidth={1.5} />} title="No brands assigned to you yet">
              Ask an admin to add you to your brands in Settings → Team.
            </Empty>
          )}
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
        subtitle={`${brands.length} brands · ${rangeLabel(range)} vs the ${range.days} days before`}
        right={<RangeTabs basePath="/dashboard" current={range.days} />}
      />

      <NavyPanel className="p-6 sm:p-8">
        <Eyebrow onDark>Portfolio · {range.days} days</Eyebrow>
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-3 xl:grid-cols-5">
          <NavyStat label="Total sales" value={money(total.totalSales)} delta={change(total.totalSales, totalPrev.totalSales)} />
          <NavyStat label="Ad sales" value={money(total.sales)} delta={change(total.sales, totalPrev.sales)} />
          <NavyStat label="Ad spend" value={money(total.cost)} delta={change(total.cost, totalPrev.cost)} invert />
          <NavyStat label="ACOS" value={pct(acos(total))} delta={change(acos(total), acos(totalPrev))} invert />
          <NavyStat label="TACOS" value={pct(tacos(total))} delta={change(tacos(total), tacos(totalPrev))} invert />
        </div>
      </NavyPanel>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ b, now, prev }) => (
          <Link key={b.slug} href={`/dashboard/${b.slug}?range=${range.days}`} className="group">
            <Card className="h-full p-6 transition-[transform,box-shadow,border-color] duration-200 group-hover:-translate-y-0.5 group-hover:border-line-strong group-hover:shadow-raised">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[17px] font-bold text-ink">{b.name}</div>
                  <div className="text-xs text-muted">
                    {b.profileCount} profile{b.profileCount === 1 ? "" : "s"} · {b.countries.join(", ") || "no marketplaces"}
                  </div>
                </div>
                <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand-ink" strokeWidth={1.5} />
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
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
          totals={AD_TOTALS}
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
            salesPrev: prev.sales,
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
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-1 font-display text-[18px] font-bold text-ink tabular">
        <Figure value={value} />
      </div>
      <Delta value={delta} invert={invert} />
    </div>
  );
}
