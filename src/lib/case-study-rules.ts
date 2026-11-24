/*
 * Case study rules: which logged actions count as a "win" worth writing up, and how they
 * are anonymized before leaving the app. Pure functions with no imports, so they can be
 * unit-tested directly (tests/case-study-rules.test.mjs).
 */

export const CASE_STUDY_RULES = {
  /** Days measured after the change (and compared with the same days before). */
  windowDays: 14,
  /** A win: sales/day up at least 15%… */
  minSalesLift: 0.15,
  /** …or ACOS down at least 5 points, as long as sales/day didn't fall more than 5%. */
  minAcosDrop: 0.05,
  maxSalesDropWithAcosWin: -0.05,
  /** Ignore tiny numbers, where one extra order looks like +300%. */
  minOrdersBefore: 5,
} as const;

export type Consent = "none" | "anonymized" | "named";
export const CONSENTS: Consent[] = ["none", "anonymized", "named"];

export type Window = { cost: number; sales: number; orders: number; clicks: number; impressions: number };

export type MeasuredInput = {
  actionId: string;
  actionDate: string; // YYYY-MM-DD
  category: string; // Action Log category value (bid, budget, …)
  description: string;
  campaignId: string | null;
  campaignName: string | null;
  adType: string | null; // SP / SB / SD for campaign-level actions
  /** Every campaign name on the brand, so a description mentioning any of them is masked. */
  otherCampaignNames?: string[];
  /** The brand's product names / SKUs, masked as [product]. */
  productNames?: string[];
  /** The brand's keywords, targets and customer search terms, masked as [keyword]. */
  keywords?: string[];
  afterDays: number;
  before: Window | null;
  after: Window | null;
};

export type BrandMeta = { slug: string; name: string; category: string | null; consent: Consent };

export type CaseCandidate = {
  id: string;
  brand: string; // "a Supplements brand", or the real name when consent is "named"
  brand_named: boolean;
  category: string | null;
  month: string; // "November 2026": no exact dates
  change: { type: string; what: string; scope: "one campaign" | "whole brand"; ad_type: string | null };
  results: {
    window_days: number;
    sales_per_day_change_pct: number;
    orders_per_day_change_pct: number | null;
    spend_per_day_change_pct: number | null;
    acos_before_pct: number | null;
    acos_after_pct: number | null;
    cvr_before_pct: number | null;
    cvr_after_pct: number | null;
  };
  why_it_qualified: string;
  strength: number;
};

const CATEGORY_LABELS: Record<string, string> = {
  bid: "Bid change",
  budget: "Budget change",
  negative: "Negative keywords",
  launch: "Launch",
  pause: "Pause",
  listing: "Listing update",
  pricing: "Price / coupon",
  other: "Other change",
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const pctChange = (now: number | null, prev: number | null) => (now == null || prev == null || prev <= 0 ? null : now / prev - 1);
const pct1 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 10); // 0.2634 → 26.3
const pct0 = (v: number | null) => (v == null ? null : Math.round(v * 100)); // 0.153 → 15

/** Does this measured action count as a win? */
export function qualifies(m: MeasuredInput, rules = CASE_STUDY_RULES): { ok: boolean; reason: string; salesLift: number | null; acosDrop: number | null } {
  const { before, after } = m;
  if (!before || !after) return { ok: false, reason: "not measured yet", salesLift: null, acosDrop: null };
  if (m.afterDays < rules.windowDays) return { ok: false, reason: `only ${m.afterDays} of ${rules.windowDays} days measured`, salesLift: null, acosDrop: null };
  if (before.orders < rules.minOrdersBefore) return { ok: false, reason: "too few orders before the change to judge", salesLift: null, acosDrop: null };
  const salesLift = pctChange(after.sales / m.afterDays, before.sales / rules.windowDays);
  const acosBefore = ratio(before.cost, before.sales);
  const acosAfter = ratio(after.cost, after.sales);
  const acosDrop = acosBefore != null && acosAfter != null ? acosBefore - acosAfter : null;
  if (salesLift != null && salesLift >= rules.minSalesLift) return { ok: true, reason: `sales/day up ${pct0(salesLift)}%`, salesLift, acosDrop };
  if (acosDrop != null && acosDrop >= rules.minAcosDrop && salesLift != null && salesLift >= rules.maxSalesDropWithAcosWin)
    return { ok: true, reason: `ACOS down ${pct1(acosDrop)} points with sales/day ${salesLift >= 0 ? "up" : "down"} ${Math.abs(pct0(salesLift)!)}%`, salesLift, acosDrop };
  return { ok: false, reason: "below the win thresholds", salesLift, acosDrop };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Words that are campaign-naming conventions, not product names ("SP | Exact | Vitamin D3" → "Vitamin D3").
const CAMPAIGN_WORDS = new Set(
  ("sp sb sd sbv spv sdv exact phrase broad auto automatic manual video display retargeting remarketing conquest conq asin asins kw kws " +
    "keyword keywords pt product products targeting target category categories brand branded defense defence legacy all old new test " +
    "research ranking rank launch top tos search store spotlight headline collection us ca uk de mx jp au eu na fe")
    .split(" "),
);

/** Product names embedded in campaign names: the parts between "|", "-", "_" or "/" that aren't naming conventions. */
export function productNamesFromCampaigns(campaignNames: string[]): string[] {
  const out = new Set<string>();
  for (const name of campaignNames) {
    for (const part of name.split(/\s*[|/_]\s*|\s+-\s+/)) {
      const words = part.trim().split(/\s+/).filter((w) => w && !CAMPAIGN_WORDS.has(w.toLowerCase().replace(/[^a-z0-9]/g, "")));
      const p = words.join(" ").trim();
      if (p.length >= 4 && /[a-z]/i.test(p) && !/^\d+$/.test(p)) out.add(p);
    }
  }
  return [...out];
}

// Placeholders are inserted as sentinels first, so a later pattern can't re-match the placeholder text.
const PH = { campaign: "\u0000C\u0000", product: "\u0000P\u0000", keyword: "\u0000K\u0000", brand: "\u0000B\u0000" } as const;
const LABEL: Record<string, string> = { C: "[campaign]", P: "[product]", K: "[keyword]", B: "the brand" };

/** Masks every term, longest first across all kinds, so "bamboo board large" isn't half-masked by "bamboo board". */
function maskTerms(text: string, groups: Array<{ terms: string[]; ph: string; minLen: number }>): string {
  const seen = new Set<string>();
  const list: Array<{ t: string; ph: string }> = [];
  for (const g of groups) {
    for (const raw of g.terms) {
      const t = raw?.trim();
      if (!t || t.length < g.minLen || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      list.push({ t, ph: g.ph });
    }
  }
  list.sort((a, b) => b.t.length - a.t.length);
  let out = text;
  for (const { t, ph } of list) out = out.replace(new RegExp(`(?<![\\w])${escapeRe(t)}(?![\\w])`, "gi"), ph);
  return out;
}

/**
 * Removes anything that could identify the client from free text: campaign names, product
 * names and SKUs, keywords and search terms, the brand's name (unless named), ASINs, quoted
 * phrases (usually keywords), emails and links.
 */
export function anonymizeText(
  text: string,
  opts: { brandNames: string[]; campaignNames: string[]; productNames?: string[]; keywords?: string[]; keepBrandName?: boolean },
): string {
  let out = text;
  out = maskTerms(out, [
    { terms: opts.campaignNames, ph: PH.campaign, minLen: 4 },
    { terms: [...(opts.productNames ?? []), ...productNamesFromCampaigns(opts.campaignNames)], ph: PH.product, minLen: 4 },
    { terms: opts.keywords ?? [], ph: PH.keyword, minLen: 3 },
    { terms: opts.keepBrandName ? [] : opts.brandNames, ph: PH.brand, minLen: 2 },
  ]);
  out = out
    .replace(/\bB0[A-Z0-9]{8}\b/gi, "[ASIN]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\bhttps?:\/\/\S+/gi, "[link]")
    .replace(/\b[A-Z0-9]{2,}(?:-[A-Z0-9]+){2,}\b/g, "[SKU]")
    // Quoted phrases are almost always keywords or search terms: "bamboo board", “gift set”, 'xyz'.
    .replace(/"[^"\n]{2,80}"|“[^”\n]{2,80}”|(?<=^|[\s(])'[^'\n]{2,80}'(?=$|[\s.,;:!?)])/g, PH.keyword)
    .replace(/\u0000([CPKB])\u0000/g, (_m, k: string) => LABEL[k]);
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Short opaque id, the same for the same action every week (so the bot can skip repeats). */
export function candidateId(actionId: string): string {
  let h = 2166136261;
  for (let i = 0; i < actionId.length; i++) h = Math.imul(h ^ actionId.charCodeAt(i), 16777619);
  return `cs_${(h >>> 0).toString(36)}`;
}

const monthLabel = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** A qualifying, anonymized case study candidate, or null. Brands without consent never produce one. */
export function toCandidate(m: MeasuredInput, brand: BrandMeta, rules = CASE_STUDY_RULES): CaseCandidate | null {
  if (brand.consent === "none") return null;
  const q = qualifies(m, rules);
  if (!q.ok || !m.before || !m.after) return null;
  const named = brand.consent === "named";
  const b = m.before;
  const a = m.after;
  const d = rules.windowDays;
  const perDay = (w: Window, days: number, k: keyof Window) => w[k] / days;
  return {
    id: candidateId(m.actionId),
    brand: named ? brand.name : `a ${brand.category ? `${brand.category} ` : ""}brand`,
    brand_named: named,
    category: brand.category,
    month: monthLabel(m.actionDate),
    change: {
      type: CATEGORY_LABELS[m.category] ?? "Change",
      what: anonymizeText(m.description, {
        brandNames: [brand.name, brand.slug, brand.slug.replace(/-/g, " ")],
        campaignNames: [...(m.campaignName ? [m.campaignName] : []), ...(m.otherCampaignNames ?? [])],
        productNames: m.productNames,
        keywords: m.keywords,
        keepBrandName: named,
      }),
      scope: m.campaignId ? "one campaign" : "whole brand",
      ad_type: m.adType,
    },
    results: {
      window_days: d,
      sales_per_day_change_pct: pct0(q.salesLift)!,
      orders_per_day_change_pct: pct0(pctChange(perDay(a, m.afterDays, "orders"), perDay(b, d, "orders"))),
      spend_per_day_change_pct: pct0(pctChange(perDay(a, m.afterDays, "cost"), perDay(b, d, "cost"))),
      acos_before_pct: pct1(ratio(b.cost, b.sales)),
      acos_after_pct: pct1(ratio(a.cost, a.sales)),
      cvr_before_pct: pct1(ratio(b.orders, b.clicks)),
      cvr_after_pct: pct1(ratio(a.orders, a.clicks)),
    },
    why_it_qualified: q.reason,
    strength: Math.round(((q.salesLift ?? 0) + Math.max(q.acosDrop ?? 0, 0) * 2) * 1000) / 1000,
  };
}
