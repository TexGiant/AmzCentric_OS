import "server-only";
import { measureActions } from "@/lib/action-impact";
import { CASE_STUDY_RULES, CONSENTS, qualifies, toCandidate, type BrandMeta, type CaseCandidate, type Consent } from "@/lib/case-study-rules";
import { demoSource } from "@/lib/data/demo";
import { adminSource } from "@/lib/data/supabase";
import type { DataSource } from "@/lib/data/types";
import { addDays, todayInTz } from "@/lib/dates";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Case study feed: measured Action Log wins from brands that allow it, anonymized.
 * Server-only; served to the case study bot by /api/insights/case-studies.
 */

// Demo brands: two allow case studies, one only anonymized, one not at all.
const DEMO_SETTINGS: Record<string, { category: string; consent: Consent }> = {
  "harbor-pine": { category: "Home & Kitchen", consent: "anonymized" },
  "lumen-labs": { category: "Supplements", consent: "anonymized" },
  "kodiak-trail": { category: "Outdoor", consent: "none" },
  bloomwell: { category: "Beauty", consent: "named" },
};

/** Category and case study permission for every brand. */
export async function brandCaseStudySettings(): Promise<BrandMeta[]> {
  if (isDemoMode()) {
    const brands = await demoSource.listBrands();
    return brands.map((b) => ({ slug: b.slug, name: b.name, category: DEMO_SETTINGS[b.slug]?.category ?? null, consent: DEMO_SETTINGS[b.slug]?.consent ?? "none" }));
  }
  const { data, error } = await createAdminClient().from("brands").select("slug, name, category, case_study_consent").order("name");
  if (error) throw new Error(`Couldn't read brand case study settings (has migration 0008 been run?): ${error.message}`);
  return (data ?? []).map((b: { slug: string; name: string; category: string | null; case_study_consent: string }) => ({
    slug: b.slug,
    name: b.name,
    category: b.category?.trim() || null,
    consent: (CONSENTS as string[]).includes(b.case_study_consent) ? (b.case_study_consent as Consent) : "none",
  }));
}

export async function saveBrandCaseStudySettings(slug: string, category: string | null, consent: Consent) {
  const { error } = await createAdminClient().from("brands").update({ category, case_study_consent: consent }).eq("slug", slug);
  if (error) throw new Error(error.message);
}

/**
 * Wins from the last `days` days whose full 14-day window has been measured, strongest first.
 * Only brands with consent "anonymized" or "named" are read at all.
 */
export async function caseStudyCandidates(opts: { days: number; limit: number }): Promise<{
  candidates: CaseCandidate[];
  brandsScanned: number;
  actionsMeasured: number;
  /** Why the other actions didn't qualify (counts only; nothing identifying). */
  notQualified: Record<string, number>;
}> {
  const ds: DataSource = isDemoMode() ? demoSource : adminSource;
  const brands = (await brandCaseStudySettings()).filter((b) => b.consent !== "none");
  let actionsMeasured = 0;
  const notQualified: Record<string, number> = {};
  const all: CaseCandidate[] = [];
  for (const brand of brands) {
    const status = await ds.brandStatus(brand.slug);
    const yesterday = addDays(todayInTz(status.timezone), -1);
    const through = status.dataThrough && status.dataThrough < yesterday ? status.dataThrough : yesterday;
    // Actions old enough for a full window after them, and within the lookback.
    const newest = addDays(through, -(CASE_STUDY_RULES.windowDays - 1));
    const oldest = addDays(through, -opts.days);
    const actions = (await ds.actions(brand.slug, 300)).filter((a) => a.actionDate >= oldest && a.actionDate <= newest);
    if (!actions.length) continue;
    // Everything that could identify the client in a description: campaigns, products/SKUs,
    // and the keywords, targets and search terms the brand advertises on.
    const termsFrom = addDays(oldest, -CASE_STUDY_RULES.windowDays);
    const [measured, campaigns, products, terms] = await Promise.all([
      measureActions(ds, brand.slug, actions, through),
      ds.campaigns(brand.slug, termsFrom, through),
      ds.products(brand.slug, termsFrom, through),
      ds.searchTerms(brand.slug, termsFrom, through),
    ]);
    const productNames = products.flatMap((p) => [p.sku ?? "", ...(p.sku ?? "").split(/\s+[·|]\s+/)]).filter(Boolean);
    const keywords = terms.flatMap((t) => [t.searchTerm, t.targeting ?? ""]).filter(Boolean);
    const adTypeOf = new Map(campaigns.map((c) => [c.campaignId, c.adProduct]));
    actionsMeasured += measured.length;
    for (const m of measured) {
      const input = {
          actionId: m.a.id,
          actionDate: m.a.actionDate,
          category: m.a.category,
          description: m.a.description,
          campaignId: m.a.campaignId,
          campaignName: m.a.campaignName,
          adType: m.a.campaignId ? (adTypeOf.get(m.a.campaignId) ?? null) : null,
          otherCampaignNames: campaigns.map((c) => c.name),
          productNames,
          keywords,
          afterDays: m.afterDays,
          before: m.before,
          after: m.after,
      };
      const c = toCandidate(input, brand);
      if (c) all.push(c);
      else {
        const why = qualifies(input).reason.replace(/^only \d+ of/, "window not complete:").replace(/ days measured$/, " days");
        notQualified[why] = (notQualified[why] ?? 0) + 1;
      }
    }
  }
  all.sort((a, b) => b.strength - a.strength);
  return { candidates: all.slice(0, opts.limit), brandsScanned: brands.length, actionsMeasured, notQualified };
}
