/**
 * Deterministic demo data so the whole app works before Supabase/Amazon are wired.
 * Every number comes from a seeded generator keyed on brand + campaign + date.
 */
import { addDays, eachDay, monthStart, todayUtc } from "@/lib/dates";
import { sum, type Totals } from "@/lib/metrics";
import type {
  ActionEntry,
  Brand,
  CampaignRow,
  DailyPoint,
  DataSource,
  HourPoint,
  ProductRow,
  SearchTermRow,
} from "@/lib/data/types";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rand(seed: string): number {
  let t = (hash(seed) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (seed: string, lo: number, hi: number) => lo + rand(seed) * (hi - lo);

type DemoProduct = { asin: string; sku: string; name: string; terms: string[] };
type DemoCampaign = {
  id: string;
  name: string;
  adProduct: "SP" | "SB" | "SD";
  asin: string;
  budget: number;
  baseSpend: number;
  cpc: number;
  ctr: number;
  cvr: number;
  aov: number;
  trend: number;
  pausedDaysAgo?: number;
  bidBumpDaysAgo?: number;
};
type DemoBrand = { slug: string; name: string; countries: string[]; products: DemoProduct[]; campaigns: DemoCampaign[] };

const CATALOG: Array<{ slug: string; name: string; countries: string[]; products: Array<[string, string[]]> }> = [
  {
    slug: "harbor-pine",
    name: "Harbor & Pine",
    countries: ["US", "CA"],
    products: [
      ["Bamboo Cutting Board Set", ["bamboo cutting board", "cutting board set", "wood cutting boards for kitchen", "large cutting board", "juice groove cutting board"]],
      ["Acacia Serving Tray", ["serving tray", "acacia wood tray", "wooden serving platter", "charcuterie board"]],
      ["Linen Napkins 12pk", ["linen napkins", "cloth napkins set of 12", "dinner napkins", "farmhouse napkins"]],
      ["Cast Iron Trivet", ["cast iron trivet", "trivet for hot pots", "kitchen trivet"]],
    ],
  },
  {
    slug: "lumen-labs",
    name: "Lumen Labs",
    countries: ["US"],
    products: [
      ["Magnesium Glycinate 120ct", ["magnesium glycinate", "magnesium supplement", "magnesium for sleep", "chelated magnesium", "magnesium 400mg"]],
      ["Vitamin D3 + K2", ["vitamin d3 k2", "d3 k2 supplement", "vitamin d 5000 iu", "k2 mk7"]],
      ["Ashwagandha Gummies", ["ashwagandha gummies", "ashwagandha", "stress relief gummies", "ksm 66"]],
      ["Electrolyte Powder", ["electrolyte powder", "hydration packets", "sugar free electrolytes", "keto electrolytes"]],
    ],
  },
  {
    slug: "kodiak-trail",
    name: "Kodiak Trail",
    countries: ["US", "UK", "DE"],
    products: [
      ["Ultralight Hammock", ["camping hammock", "ultralight hammock", "hammock with straps", "portable hammock"]],
      ["Trekking Poles Pair", ["trekking poles", "hiking poles collapsible", "walking sticks for hiking", "carbon trekking poles"]],
      ["Insulated Water Bottle 32oz", ["insulated water bottle", "32 oz water bottle", "stainless steel bottle", "hydro bottle"]],
    ],
  },
  {
    slug: "bloomwell",
    name: "Bloomwell Skin",
    countries: ["US"],
    products: [
      ["Vitamin C Face Serum", ["vitamin c serum", "vitamin c serum for face", "brightening serum", "dark spot corrector"]],
      ["Hyaluronic Acid Moisturizer", ["hyaluronic acid moisturizer", "face moisturizer", "moisturizer for dry skin"]],
      ["Retinol Night Cream", ["retinol cream", "night cream", "anti aging cream", "retinol moisturizer"]],
    ],
  },
];

function buildBrand(spec: (typeof CATALOG)[number]): DemoBrand {
  const products: DemoProduct[] = spec.products.map(([name, terms], i) => ({
    asin: `B0${(hash(spec.slug + name) % 1e8).toString(36).toUpperCase().padStart(8, "X")}`.slice(0, 10),
    sku: `${spec.slug.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, "0")}`,
    name,
    terms,
  }));
  const campaigns: DemoCampaign[] = [];
  products.forEach((p, i) => {
    const kinds: Array<[string, "SP" | "SB" | "SD", number]> = [
      ["SP | Auto", "SP", 0.8],
      ["SP | Exact", "SP", 1.2],
      ["SP | Broad", "SP", 0.7],
    ];
    if (i === 0) kinds.push(["SB | Video", "SB", 0.9], ["SD | Retargeting", "SD", 0.4]);
    if (i === 1) kinds.push(["SP | Competitor ASIN", "SP", 0.5]);
    for (const [label, adProduct, weight] of kinds) {
      const id = String(1e11 + (hash(spec.slug + p.name + label) % 9e11));
      const s = `${spec.slug}:${id}`;
      campaigns.push({
        id,
        name: `${label} | ${p.name}`,
        adProduct,
        asin: p.asin,
        budget: Math.round(between(s + "b", 40, 160) * weight) * 1,
        baseSpend: between(s + "sp", 25, 110) * weight,
        cpc: between(s + "cpc", 0.55, 1.9),
        ctr: between(s + "ctr", 0.0025, 0.007),
        cvr: between(s + "cvr", 0.06, 0.17) * (label.includes("Exact") ? 1.3 : 1),
        aov: between(s + "aov", 22, 48),
        trend: between(s + "tr", -0.25, 0.35),
      });
    }
  });
  // A couple of storylines so "What changed" and the action log have something to explain.
  campaigns[2].pausedDaysAgo = 9;
  campaigns[1].bidBumpDaysAgo = 12;
  return { slug: spec.slug, name: spec.name, countries: spec.countries, products, campaigns };
}

const BRANDS = CATALOG.map(buildBrand);
const brandBySlug = (slug: string) => BRANDS.find((b) => b.slug === slug);

/** One campaign's metrics on one day. */
function campaignDay(b: DemoBrand, c: DemoCampaign, date: string): Totals {
  const today = todayUtc();
  const ago = Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000);
  if (ago < 0 || ago > 400) return { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, units: 0 };
  if (c.pausedDaysAgo != null && ago < c.pausedDaysAgo) return { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, units: 0 };

  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const season = dow === 0 || dow === 6 ? 1.12 : dow === 1 ? 0.94 : 1;
  const trend = 1 + c.trend * (1 - ago / 120);
  const wave = 1 + 0.08 * Math.sin((ago / 9) * Math.PI);
  const noise = between(`${c.id}:${date}:n`, 0.82, 1.18);
  const bump = c.bidBumpDaysAgo != null && ago < c.bidBumpDaysAgo ? 1.28 : 1;

  const cost = c.baseSpend * season * trend * wave * noise * bump;
  const cpc = c.cpc * (bump > 1 ? 1.12 : 1) * between(`${c.id}:${date}:c`, 0.92, 1.08);
  const clicks = Math.max(0, Math.round(cost / cpc));
  const impressions = Math.round(clicks / (c.ctr * between(`${c.id}:${date}:t`, 0.85, 1.15)));
  const orders = Math.round(clicks * c.cvr * between(`${c.id}:${date}:o`, 0.7, 1.3));
  const sales = orders * c.aov * between(`${c.id}:${date}:a`, 0.9, 1.1);
  return { impressions, clicks, cost: clicks * cpc, sales, orders, units: Math.round(orders * 1.12) };
}

function campaignRange(b: DemoBrand, c: DemoCampaign, from: string, to: string): Totals {
  return sum(eachDay(from, to).map((d) => campaignDay(b, c, d)));
}

const HOUR_CURVE = [0.012, 0.008, 0.006, 0.005, 0.006, 0.011, 0.021, 0.032, 0.041, 0.047, 0.05, 0.053, 0.055, 0.054, 0.052, 0.051, 0.052, 0.056, 0.062, 0.068, 0.072, 0.066, 0.048, 0.026];
const HOUR_SUM = HOUR_CURVE.reduce((a, b) => a + b, 0);

export const demoSource: DataSource = {
  async listBrands() {
    return BRANDS.map((b): Brand => ({ slug: b.slug, name: b.name, profileCount: b.countries.length, countries: b.countries }));
  },

  async brandStatus(slug) {
    const b = brandBySlug(slug);
    return {
      profiles: b?.countries.length ?? 0,
      dataThrough: addDays(todayUtc(), -1),
      streamLastHour: new Date(Date.now() - 3600_000).toISOString(),
      spApiConnected: true,
      timezone: "UTC",
    };
  },

  async brandDaily(slug, from, to) {
    const b = brandBySlug(slug);
    if (!b) return [];
    return eachDay(from, to).map((date): DailyPoint => {
      const t = sum(b.campaigns.map((c) => campaignDay(b, c, date)));
      return { date, ...t, totalSales: t.sales * between(`${slug}:${date}:org`, 2.0, 2.5) };
    });
  },

  async campaigns(slug, from, to) {
    const b = brandBySlug(slug);
    if (!b) return [];
    return b.campaigns.map((c): CampaignRow => ({
      campaignId: c.id,
      name: c.name,
      adProduct: c.adProduct,
      state: c.pausedDaysAgo != null ? "paused" : "enabled",
      budget: c.budget,
      ...campaignRange(b, c, from, to),
    }));
  },

  async searchTerms(slug, from, to) {
    const b = brandBySlug(slug);
    if (!b) return [];
    const rows: SearchTermRow[] = [];
    for (const c of b.campaigns.filter((c) => c.adProduct === "SP")) {
      const t = campaignRange(b, c, from, to);
      const product = b.products.find((p) => p.asin === c.asin)!;
      const terms = [...product.terms, `${product.terms[0]} ${["for women", "premium", "best", "gift"][hash(c.id) % 4]}`];
      const weights = terms.map((term) => between(`${c.id}:${term}:w`, 0.2, 1));
      const wsum = weights.reduce((a, x) => a + x, 0);
      terms.forEach((term, i) => {
        const share = weights[i] / wsum;
        const quality = between(`${c.id}:${term}:q`, 0, 1.6);
        const clicks = Math.round(t.clicks * share);
        const orders = quality < 0.25 ? 0 : Math.round(t.orders * share * quality);
        rows.push({
          searchTerm: term,
          targeting: c.name.includes("Auto") ? "close-match" : c.name.includes("Exact") ? term : product.terms[0],
          matchType: c.name.includes("Auto") ? "TARGETING_EXPRESSION_PREDEFINED" : c.name.includes("Exact") ? "EXACT" : "BROAD",
          campaignId: c.id,
          campaignName: c.name,
          impressions: Math.round(t.impressions * share),
          clicks,
          cost: t.cost * share,
          orders,
          sales: t.orders ? (t.sales / t.orders) * orders : 0,
          units: Math.round(orders * 1.1),
        });
      });
    }
    return rows.sort((a, b) => b.cost - a.cost);
  },

  async products(slug, from, to) {
    const b = brandBySlug(slug);
    if (!b) return [];
    return b.products.map((p): ProductRow => ({
      asin: p.asin,
      sku: `${p.sku} · ${p.name}`,
      ...sum(b.campaigns.filter((c) => c.asin === p.asin && c.adProduct === "SP").map((c) => campaignRange(b, c, from, to))),
    }));
  },

  async hourly(slug, day) {
    const b = brandBySlug(slug);
    if (!b) return [];
    const isToday = day === todayUtc();
    const day0 = isToday ? addDays(day, -1) : day; // today's shape uses yesterday's volume
    const t = sum(b.campaigns.map((c) => campaignDay(b, c, day0)));
    const nowHour = new Date().getUTCHours();
    return HOUR_CURVE.map((w, hour): HourPoint => {
      if (isToday && hour > nowHour) return { hour, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
      const f = (w / HOUR_SUM) * between(`${slug}:${day}:${hour}`, 0.75, 1.25);
      const conv = between(`${slug}:${day}:${hour}:c`, 0.6, 1.4);
      return {
        hour,
        impressions: Math.round(t.impressions * f),
        clicks: Math.round(t.clicks * f),
        cost: t.cost * f,
        sales: t.sales * f * conv,
        orders: Math.round(t.orders * f * conv),
      };
    });
  },

  async window(slug, campaignId, from, to) {
    const b = brandBySlug(slug);
    if (!b) return sum([]);
    const cs = campaignId ? b.campaigns.filter((c) => c.id === campaignId) : b.campaigns;
    return sum(cs.map((c) => campaignRange(b, c, from, to)));
  },

  async actions(slug, limit = 100) {
    const b = brandBySlug(slug);
    if (!b) return [];
    const t = todayUtc();
    const c = b.campaigns;
    const entries: Array<Omit<ActionEntry, "id">> = [
      { actionDate: addDays(t, -2), category: "negative", description: "Added 14 negative exact terms with 10+ clicks and no orders", campaignId: c[0].id, campaignName: c[0].name, authorEmail: "sam@amzcentric.com" },
      { actionDate: addDays(t, -9), category: "pause", description: "Paused broad campaign — ACOS 2x target for 3 weeks", campaignId: c[2].id, campaignName: c[2].name, authorEmail: "priya@amzcentric.com" },
      { actionDate: addDays(t, -12), category: "bid", description: "Raised top-of-search bids +25% on hero exact keywords", campaignId: c[1].id, campaignName: c[1].name, authorEmail: "sam@amzcentric.com" },
      { actionDate: addDays(t, -18), category: "listing", description: "New main image + A+ content live", campaignId: null, campaignName: null, authorEmail: "priya@amzcentric.com" },
      { actionDate: addDays(t, -26), category: "budget", description: "Budget $60 → $90/day, capped out by 4pm daily", campaignId: c[3].id, campaignName: c[3].name, authorEmail: "sam@amzcentric.com" },
      { actionDate: addDays(t, -33), category: "launch", description: "Launched competitor ASIN targeting", campaignId: c[c.length - 1].id, campaignName: c[c.length - 1].name, authorEmail: "priya@amzcentric.com" },
    ];
    return entries.slice(0, limit).map((e, i) => ({ id: `demo-${i}`, ...e }));
  },

  async goal(slug, month) {
    const b = brandBySlug(slug);
    if (!b) return null;
    const to = addDays(todayUtc(), -1);
    const prev = sum(b.campaigns.map((c) => campaignRange(b, c, addDays(to, -29), to)));
    return {
      month: monthStart(month),
      salesTarget: Math.round((prev.sales * 2.25 * 1.08) / 1000) * 1000,
      spendBudget: Math.round((prev.cost * 1.05) / 500) * 500,
      acosTarget: 0.28,
    };
  },
};
