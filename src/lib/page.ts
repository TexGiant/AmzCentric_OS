import "server-only";
import { notFound } from "next/navigation";
import { data } from "@/lib/data";
import { addDays, resolveRange, shortDate, todayInTz, type Range } from "@/lib/dates";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export type BrandParams = Promise<{ brand: string }>;

export function param(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export async function getBrandOr404(slug: string) {
  const brands = await data().listBrands();
  const brand = brands.find((b) => b.slug === slug);
  if (!brand) notFound();
  return brand;
}

/**
 * Dates for a brand, in its marketplace timezone (Pacific for US), like the Amazon Ads console.
 * `through` = the last day whose Amazon report has arrived (normally yesterday); ranges end there,
 * so a late report never shows up as a half-empty day.
 */
export async function brandClock(slug: string) {
  const status = await data().brandStatus(slug);
  const today = todayInTz(status.timezone);
  const yesterday = addDays(today, -1);
  const through = status.dataThrough && status.dataThrough < yesterday ? status.dataThrough : yesterday;
  return { status, today, yesterday, through, pending: through < yesterday ? yesterday : null };
}

export type BrandRange = Range & { pending: string | null };

export async function brandRange(slug: string, raw: string | string[] | undefined, fallback = 30): Promise<BrandRange> {
  const c = await brandClock(slug);
  return { ...resolveRange(raw, fallback, c.through), pending: c.pending };
}

/** "Nov 13 – Nov 18" plus a note when the latest report hasn't arrived yet. */
export function rangeLabel(r: { from: string; to: string; pending?: string | null }) {
  return `${shortDate(r.from)} – ${shortDate(r.to)}${r.pending ? ` · ${shortDate(r.pending)} report pending` : ""}`;
}
