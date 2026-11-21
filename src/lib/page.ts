import "server-only";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/access";
import { data } from "@/lib/data";
import type { Perm } from "@/lib/rbac";
import { addDays, customRange, resolveRange, shortDate, todayInTz, type Range } from "@/lib/dates";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export type BrandParams = Promise<{ brand: string }>;

export function param(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Every brand page starts here: the person must see the brand and hold the page's
 * permission, or they get a 404 (nothing about the brand is revealed).
 */
export async function getBrandOr404(slug: string, perm: Perm) {
  const access = await requirePerm(perm, slug);
  const brands = await data().listBrands();
  const brand = brands.find((b) => b.slug === slug);
  if (!brand) notFound();
  return Object.assign(brand, { access });
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

export type BrandRange = Range & { pending: string | null; through: string };

/**
 * `raw` is the preset ("7", "30"…). Pass `custom` (from the ?from=&to= params) to allow a
 * hand-picked range; it wins over the preset when its dates are valid.
 */
export async function brandRange(
  slug: string,
  raw: string | string[] | undefined,
  fallback = 30,
  custom?: { from?: string; to?: string },
): Promise<BrandRange> {
  const c = await brandClock(slug);
  const picked = custom ? customRange(custom.from, custom.to, c.through) : null;
  const r = picked ?? resolveRange(raw, fallback, c.through);
  // A custom range that ends before the latest day isn't "pending" — it's what was asked for.
  return { ...r, pending: picked && r.to < c.through ? null : c.pending, through: c.through };
}

/** The ?from=&to= params, for pages that support a custom range. */
export function customParams(sp: Record<string, string | string[] | undefined>) {
  return { from: param(sp, "from"), to: param(sp, "to") };
}

/** "Nov 13 – Nov 18" plus a note when the latest report hasn't arrived yet. */
export function rangeLabel(r: { from: string; to: string; pending?: string | null; custom?: boolean; days?: number }) {
  const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4);
  const fmt = (d: string, withYear: boolean) => (withYear ? `${shortDate(d)}, ${d.slice(0, 4)}` : shortDate(d));
  const span = r.custom ? `${fmt(r.from, !sameYear)} – ${fmt(r.to, true)} (${r.days} days)` : `${shortDate(r.from)} – ${shortDate(r.to)}`;
  return `${span}${r.pending ? ` · ${shortDate(r.pending)} report pending` : ""}`;
}
