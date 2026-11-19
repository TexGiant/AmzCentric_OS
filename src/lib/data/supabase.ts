import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Totals } from "@/lib/metrics";
import type {
  ActionEntry,
  Brand,
  CampaignRow,
  DailyPoint,
  DataSource,
  Goal,
  HourPoint,
  ProductRow,
  SearchTermRow,
} from "@/lib/data/types";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

function totals(r: Row): Totals {
  return {
    impressions: n(r.impressions),
    clicks: n(r.clicks),
    cost: n(r.cost),
    sales: n(r.sales),
    orders: n(r.orders),
    units: n(r.units),
  };
}

type GetDb = () => Promise<SupabaseClient> | SupabaseClient;

async function rpcWith(getDb: GetDb, fn: string, args: Record<string, unknown>): Promise<Row[]> {
  const db = await getDb();
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (data ?? []) as Row[];
}

/**
 * Data source over a Supabase client. The dashboard uses the signed-in user's client
 * (RLS applies); the Claude connector uses the service-role client after verifying
 * the caller's OAuth token itself.
 */
export function makeSupabaseSource(getDb: GetDb): DataSource {
  const rpc = (fn: string, args: Record<string, unknown>) => rpcWith(getDb, fn, args);
  return {
  async listBrands() {
    const db = await getDb();
    const { data, error } = await db
      .from("brands")
      .select("slug, name, amazon_profiles(country_code, enabled)")
      .order("name");
    if (error) throw error;
    return (data ?? []).map((b): Brand => {
      const profiles = ((b.amazon_profiles ?? []) as { country_code: string; enabled: boolean }[]).filter((p) => p.enabled);
      return {
        slug: b.slug,
        name: b.name,
        profileCount: profiles.length,
        countries: [...new Set(profiles.map((p) => p.country_code).filter(Boolean))],
      };
    });
  },

  async brandStatus(brand) {
    const db = await getDb();
    const [{ count }, through, campaigns] = await Promise.all([
      db.from("amazon_profiles").select("profile_id", { count: "exact", head: true }).eq("brand_slug", brand).eq("enabled", true),
      db.rpc("brand_data_through", { p_brand: brand }),
      db.from("amazon_profiles").select("profile_id, timezone, campaigns(campaign_id)").eq("brand_slug", brand).eq("enabled", true),
    ]);
    const ids = (campaigns.data ?? []).flatMap((p) => ((p.campaigns ?? []) as { campaign_id: string }[]).map((c) => c.campaign_id));
    let streamLastHour: string | null = null;
    if (ids.length) {
      const { data } = await db
        .from("stream_traffic")
        .select("time_window_start")
        .in("campaign_id", ids.slice(0, 300))
        .order("time_window_start", { ascending: false })
        .limit(1);
      streamLastHour = (data?.[0]?.time_window_start as string) ?? null;
    }
    return {
      profiles: count ?? 0,
      dataThrough: (through.data as string | null) ?? null,
      streamLastHour,
      spApiConnected: false,
      timezone: (campaigns.data?.[0]?.timezone as string) ?? "America/Los_Angeles",
    };
  },

  async brandDaily(brand, from, to) {
    const rows = await rpc("brand_daily", { p_brand: brand, p_from: from, p_to: to });
    return rows.map((r): DailyPoint => ({
      date: String(r.date),
      ...totals(r),
      totalSales: r.total_sales == null ? null : n(r.total_sales),
    }));
  },

  async campaigns(brand, from, to) {
    const rows = await rpc("campaign_summary", { p_brand: brand, p_from: from, p_to: to });
    return rows.map((r): CampaignRow => ({
      campaignId: String(r.campaign_id),
      name: (r.name as string) ?? String(r.campaign_id),
      adProduct: String(r.ad_product ?? "SP"),
      state: (r.state as string) ?? null,
      budget: r.budget == null ? null : n(r.budget),
      ...totals(r),
    }));
  },

  async searchTerms(brand, from, to) {
    const rows = await rpc("search_term_summary", { p_brand: brand, p_from: from, p_to: to, p_limit: 1000 });
    return rows.map((r): SearchTermRow => ({
      searchTerm: String(r.search_term),
      targeting: String(r.targeting ?? ""),
      matchType: (r.match_type as string) ?? null,
      campaignId: String(r.campaign_id),
      campaignName: (r.campaign_name as string) ?? String(r.campaign_id),
      ...totals(r),
    }));
  },

  async products(brand, from, to) {
    const rows = await rpc("product_summary", { p_brand: brand, p_from: from, p_to: to });
    return rows.map((r): ProductRow => ({ asin: String(r.asin), sku: (r.sku as string) ?? null, ...totals(r) }));
  },

  async hourly(brand, day) {
    const rows = await rpc("hourly_summary", { p_brand: brand, p_day: day });
    return rows.map((r): HourPoint => ({
      hour: n(r.hour),
      impressions: n(r.impressions),
      clicks: n(r.clicks),
      cost: n(r.cost),
      sales: n(r.sales),
      orders: n(r.orders),
    }));
  },

  async window(brand, campaignId, from, to) {
    const rows = await rpc("metrics_window", { p_brand: brand, p_campaign: campaignId, p_from: from, p_to: to });
    return rows[0] ? totals(rows[0]) : { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, units: 0 };
  },

  async actions(brand, limit = 100) {
    const db = await getDb();
    const { data, error } = await db
      .from("action_log")
      .select("id, action_date, category, description, campaign_id, campaign_name, author_email")
      .eq("brand_slug", brand)
      .order("action_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((a): ActionEntry => ({
      id: a.id,
      actionDate: a.action_date,
      category: a.category,
      description: a.description,
      campaignId: a.campaign_id,
      campaignName: a.campaign_name,
      authorEmail: a.author_email,
    }));
  },

  async goal(brand, month) {
    const db = await getDb();
    const { data } = await db.from("goals").select("*").eq("brand_slug", brand).eq("month", month).maybeSingle();
    if (!data) return null;
    return {
      month: data.month,
      salesTarget: data.sales_target == null ? null : n(data.sales_target),
      spendBudget: data.spend_budget == null ? null : n(data.spend_budget),
      acosTarget: data.acos_target == null ? null : n(data.acos_target),
    } satisfies Goal;
  },
};
}

export const supabaseSource: DataSource = makeSupabaseSource(createClient);
export const adminSource: DataSource = makeSupabaseSource(createAdminClient);
