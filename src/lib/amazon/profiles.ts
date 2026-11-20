import "server-only";
import type { AmazonProfile } from "@/lib/amazon/ads";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Save an account's advertising profiles. New profiles arrive disabled and unassigned;
 * existing ones keep their brand/enabled settings (they may move to this account).
 * Returns how many were new.
 */
export async function importProfiles(accountId: string, profiles: AmazonProfile[]): Promise<number> {
  if (!profiles.length) return 0;
  const db = createAdminClient();
  const ids = profiles.map((p) => String(p.profileId));
  const { data: existing } = await db.from("amazon_profiles").select("profile_id").in("profile_id", ids);
  const known = new Set((existing ?? []).map((r) => r.profile_id as string));
  const { error } = await db.from("amazon_profiles").upsert(
    profiles.map((p) => ({
      profile_id: String(p.profileId),
      account_id: accountId,
      country_code: p.countryCode,
      currency_code: p.currencyCode,
      timezone: p.timezone,
      marketplace_id: p.accountInfo?.marketplaceStringId,
      account_info_id: p.accountInfo?.id,
      account_name: p.accountInfo?.name,
      account_type: p.accountInfo?.type,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "profile_id" },
  );
  if (error) throw error;
  return ids.filter((id) => !known.has(id)).length;
}
