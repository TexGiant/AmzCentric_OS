import type { Totals } from "@/lib/metrics";

export type Brand = { slug: string; name: string; profileCount: number; countries: string[] };

export type DailyPoint = Totals & { date: string };

export type CampaignRow = Totals & {
  campaignId: string;
  name: string;
  adProduct: string;
  state: string | null;
  budget: number | null;
};

export type SearchTermRow = Totals & {
  searchTerm: string;
  targeting: string;
  matchType: string | null;
  campaignId: string;
  campaignName: string;
};

export type ProductRow = Totals & { asin: string; sku: string | null };

export type HourPoint = { hour: number; impressions: number; clicks: number; cost: number; sales: number; orders: number };

export type ActionCategory = "bid" | "budget" | "negative" | "launch" | "pause" | "listing" | "pricing" | "other";

export const ACTION_CATEGORIES: { value: ActionCategory; label: string }[] = [
  { value: "bid", label: "Bid change" },
  { value: "budget", label: "Budget change" },
  { value: "negative", label: "Negatives added" },
  { value: "launch", label: "Launch" },
  { value: "pause", label: "Pause" },
  { value: "listing", label: "Listing update" },
  { value: "pricing", label: "Price / coupon" },
  { value: "other", label: "Other" },
];

export type ActionEntry = {
  id: string;
  actionDate: string;
  category: ActionCategory;
  description: string;
  campaignId: string | null;
  campaignName: string | null;
  authorEmail: string | null;
};

export type Goal = { month: string; salesTarget: number | null; spendBudget: number | null; acosTarget: number | null };

export type BrandStatus = {
  profiles: number;
  dataThrough: string | null;
  streamLastHour: string | null;
  spApiConnected: boolean;
};

export interface DataSource {
  listBrands(): Promise<Brand[]>;
  brandStatus(brand: string): Promise<BrandStatus>;
  brandDaily(brand: string, from: string, to: string): Promise<DailyPoint[]>;
  campaigns(brand: string, from: string, to: string): Promise<CampaignRow[]>;
  searchTerms(brand: string, from: string, to: string): Promise<SearchTermRow[]>;
  products(brand: string, from: string, to: string): Promise<ProductRow[]>;
  hourly(brand: string, day: string): Promise<HourPoint[]>;
  window(brand: string, campaignId: string | null, from: string, to: string): Promise<Totals>;
  actions(brand: string, limit?: number): Promise<ActionEntry[]>;
  goal(brand: string, month: string): Promise<Goal | null>;
}
