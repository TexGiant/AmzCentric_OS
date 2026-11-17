/**
 * Ads API v3 report definitions → table rows.
 * Docs: https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/report-types
 */

export type ReportType = "spCampaigns" | "sbCampaigns" | "sdCampaigns" | "spSearchTerm" | "spAdvertisedProduct";
export type FactTable = "campaign_daily" | "search_term_daily" | "product_daily";
type Row = Record<string, unknown>;

export type ReportSpec = {
  label: string;
  adProduct: "SPONSORED_PRODUCTS" | "SPONSORED_BRANDS" | "SPONSORED_DISPLAY";
  short: "SP" | "SB" | "SD";
  groupBy: string[];
  columns: string[];
  table: FactTable;
  conflict: string;
  /** Keys that identify a row (for de-duplicating inside one upsert batch). */
  keys: string[];
  map: (r: Row, profileId: string) => Row;
  /** Report retention in days — backfills are capped to this. */
  retentionDays: number;
};

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

const SP_METRICS = ["impressions", "clicks", "cost", "sales7d", "purchases7d", "unitsSoldClicks7d"];
const SB_SD_METRICS = ["impressions", "clicks", "cost", "sales", "purchases", "unitsSold"];

const spMetrics = (r: Row) => ({
  impressions: num(r.impressions),
  clicks: num(r.clicks),
  cost: num(r.cost),
  sales: num(r.sales7d),
  orders: num(r.purchases7d),
  units: num(r.unitsSoldClicks7d),
});

const sbSdMetrics = (r: Row) => ({
  impressions: num(r.impressions),
  clicks: num(r.clicks),
  cost: num(r.cost),
  sales: num(r.sales),
  orders: num(r.purchases),
  units: num(r.unitsSold),
});

const CAMPAIGN_DIMS = ["date", "campaignId", "campaignName", "campaignStatus", "campaignBudgetAmount"];
const CAMPAIGN_KEYS = ["profile_id", "campaign_id", "date"];

function campaignSpec(short: "SP" | "SB" | "SD"): ReportSpec {
  const adProduct =
    short === "SP" ? "SPONSORED_PRODUCTS" : short === "SB" ? "SPONSORED_BRANDS" : "SPONSORED_DISPLAY";
  const metrics = short === "SP" ? spMetrics : sbSdMetrics;
  return {
    label: `${short} campaigns`,
    adProduct,
    short,
    groupBy: ["campaign"],
    columns: [...CAMPAIGN_DIMS, ...(short === "SP" ? SP_METRICS : SB_SD_METRICS)],
    table: "campaign_daily",
    conflict: CAMPAIGN_KEYS.join(","),
    keys: CAMPAIGN_KEYS,
    retentionDays: short === "SB" ? 60 : 95,
    map: (r, profileId) => ({
      profile_id: profileId,
      campaign_id: str(r.campaignId),
      date: str(r.date),
      ad_product: short,
      ...metrics(r),
    }),
  };
}

export const REPORT_SPECS: Record<ReportType, ReportSpec> = {
  spCampaigns: campaignSpec("SP"),
  sbCampaigns: campaignSpec("SB"),
  sdCampaigns: campaignSpec("SD"),
  spSearchTerm: {
    label: "SP search terms",
    adProduct: "SPONSORED_PRODUCTS",
    short: "SP",
    groupBy: ["searchTerm"],
    columns: ["date", "campaignId", "adGroupId", "keyword", "targeting", "matchType", "searchTerm", ...SP_METRICS],
    table: "search_term_daily",
    conflict: "profile_id,date,campaign_id,ad_group_id,targeting,search_term",
    keys: ["profile_id", "date", "campaign_id", "ad_group_id", "targeting", "search_term"],
    retentionDays: 95,
    map: (r, profileId) => ({
      profile_id: profileId,
      date: str(r.date),
      campaign_id: str(r.campaignId),
      ad_group_id: str(r.adGroupId),
      targeting: str(r.keyword || r.targeting),
      match_type: r.matchType ? str(r.matchType) : null,
      search_term: str(r.searchTerm),
      ...spMetrics(r),
    }),
  },
  spAdvertisedProduct: {
    label: "SP advertised products",
    adProduct: "SPONSORED_PRODUCTS",
    short: "SP",
    groupBy: ["advertiser"],
    columns: ["date", "campaignId", "adGroupId", "advertisedAsin", "advertisedSku", ...SP_METRICS],
    table: "product_daily",
    conflict: "profile_id,date,campaign_id,ad_group_id,asin",
    keys: ["profile_id", "date", "campaign_id", "ad_group_id", "asin"],
    retentionDays: 95,
    map: (r, profileId) => ({
      profile_id: profileId,
      date: str(r.date),
      campaign_id: str(r.campaignId),
      ad_group_id: str(r.adGroupId),
      asin: str(r.advertisedAsin),
      sku: r.advertisedSku ? str(r.advertisedSku) : null,
      ...spMetrics(r),
    }),
  },
};

export const ALL_REPORT_TYPES = Object.keys(REPORT_SPECS) as ReportType[];

export function isReportType(v: unknown): v is ReportType {
  return typeof v === "string" && v in REPORT_SPECS;
}

const METRIC_FIELDS = ["impressions", "clicks", "cost", "sales", "orders", "units"];

/** Merge rows that share a primary key (Postgres rejects duplicate keys in one upsert). */
export function dedupeRows(rows: Row[], keys: string[]): Row[] {
  const byKey = new Map<string, Row>();
  for (const row of rows) {
    const k = keys.map((key) => String(row[key] ?? "")).join("\u0000");
    const existing = byKey.get(k);
    if (!existing) {
      byKey.set(k, { ...row });
      continue;
    }
    for (const f of METRIC_FIELDS) existing[f] = num(existing[f]) + num(row[f]);
  }
  return [...byKey.values()];
}

/** Campaign dimension rows (name/state/budget) from a campaign report. */
export function campaignDimensions(raw: Row[], profileId: string, short: string): Row[] {
  const latest = new Map<string, Row>();
  for (const r of raw) {
    const id = str(r.campaignId);
    if (!id) continue;
    const prev = latest.get(id);
    if (prev && str(prev.date) >= str(r.date)) continue;
    latest.set(id, r);
  }
  return [...latest.values()].map((r) => ({
    campaign_id: str(r.campaignId),
    profile_id: profileId,
    ad_product: short,
    name: r.campaignName ? str(r.campaignName) : null,
    state: r.campaignStatus ? str(r.campaignStatus).toLowerCase() : null,
    budget: r.campaignBudgetAmount == null ? null : num(r.campaignBudgetAmount),
    updated_at: new Date().toISOString(),
  }));
}
