"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AdsAccount } from "@/lib/amazon/ads";
import { AdsApiError, listProfiles, isRegion } from "@/lib/amazon/ads";
import { importProfiles } from "@/lib/amazon/profiles";
import { createStreamSubscription, isLive, listStreamSubscriptions, STREAM_DATASETS } from "@/lib/amazon/stream";
import { ingestStream, streamDestinations } from "@/lib/stream/sqs";
import { requireAdminAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FormState } from "@/app/workspace-actions";

const DEMO: FormState = { error: "Demo mode: connect Supabase to save changes." };

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// ── Brands ────────────────────────────────────────────────────────────
export async function createBrand(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireAdminAccess();
  if (isDemoMode()) return DEMO;
  const name = String(form.get("name") ?? "").trim();
  const slug = slugify(String(form.get("slug") || name));
  if (!name || !slug) return { error: "Enter a brand name." };
  const { error } = await createAdminClient().from("brands").insert({ slug, name });
  if (error) return { error: error.code === "23505" ? "A brand with that slug already exists." : error.message };
  await audit({ action: "brand.create", actor: me, brand: slug, detail: { name } });
  revalidatePath("/", "layout");
  return { ok: true, message: `Created ${name}.` };
}

export async function renameBrand(form: FormData) {
  const me = await requireAdminAccess();
  if (isDemoMode()) return;
  const slug = String(form.get("slug"));
  const name = String(form.get("name") ?? "").trim();
  if (name) await createAdminClient().from("brands").update({ name }).eq("slug", slug);
  if (name) await audit({ action: "brand.rename", actor: me, brand: slug, detail: { name } });
  revalidatePath("/", "layout");
}

export async function deleteBrand(form: FormData) {
  const me = await requireAdminAccess();
  if (isDemoMode()) return;
  await createAdminClient().from("brands").delete().eq("slug", String(form.get("slug")));
  await audit({ action: "brand.delete", actor: me, brand: String(form.get("slug")) });
  revalidatePath("/", "layout");
}

// ── Amazon connections ────────────────────────────────────────────────
export async function updateProfile(form: FormData) {
  const me = await requireAdminAccess();
  if (isDemoMode()) return;
  const brand = String(form.get("brand_slug") ?? "");
  await createAdminClient()
    .from("amazon_profiles")
    .update({
      enabled: form.get("enabled") === "on",
      brand_slug: brand || null,
      display_name: String(form.get("display_name") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("profile_id", String(form.get("profile_id")));
  await audit({ action: "profile.update", actor: me, brand: brand || null, target: String(form.get("profile_id")), detail: { enabled: form.get("enabled") === "on" } });
  revalidatePath("/", "layout");
}

export async function renameAccount(form: FormData) {
  const me = await requireAdminAccess();
  if (isDemoMode()) return;
  const name = String(form.get("name") ?? "").trim();
  if (name) await createAdminClient().from("amazon_accounts").update({ name }).eq("id", String(form.get("id")));
  revalidatePath("/settings/connections");
}

export async function disconnectAccount(form: FormData) {
  const me = await requireAdminAccess();
  if (isDemoMode()) return;
  await createAdminClient().from("amazon_accounts").delete().eq("id", String(form.get("id")));
  await audit({ action: "amazon.disconnect", actor: me, target: String(form.get("id")) });
  revalidatePath("/", "layout");
}

// ── Marketing Stream subscriptions ───────────────────────────────────
/** Create any missing sp-traffic / sp-conversion subscriptions for one profile, then confirm them. */
export async function subscribeStream(form: FormData) {
  const me = await requireAdminAccess();
  if (isDemoMode()) redirect("/settings/connections?error=demo");
  const profileId = String(form.get("profile_id") ?? "");
  const back = (params: Record<string, string>) => redirect(`/settings/connections?${new URLSearchParams(params)}#stream`);

  const destinations = streamDestinations();
  const { data: row } = await createAdminClient()
    .from("amazon_profiles")
    .select("profile_id, account_name, account:amazon_accounts(id, region, refresh_token)")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!row) back({ stream_error: "Profile not found" });
  const account = (Array.isArray(row!.account) ? row!.account[0] : row!.account) as AdsAccount;
  const name = row!.account_name ?? profileId;

  const errMsg = (err: unknown) => (err instanceof AdsApiError ? `${err.status} ${err.body.slice(0, 240)}` : String(err).slice(0, 240));
  let created = 0;
  const failures: string[] = [];
  let existing: Awaited<ReturnType<typeof listStreamSubscriptions>> = [];
  try {
    existing = await listStreamSubscriptions(account, profileId);
  } catch (err) {
    back({ stream_error: `${name}: couldn't list subscriptions (${errMsg(err)})` });
  }
  // One dataset failing (e.g. no Sponsored Display on this account) shouldn't block the rest.
  for (const dataset of STREAM_DATASETS) {
    const arn = destinations[dataset];
    if (!arn) continue;
    if (existing.some((s) => s.dataSetId === dataset && s.destinationArn === arn && isLive(s))) continue;
    try {
      await createStreamSubscription(account, profileId, dataset, arn);
      created++;
    } catch (err) {
      failures.push(`${dataset}: ${errMsg(err)}`);
    }
  }

  // Amazon sends an SNS confirmation message to each queue; reading the queue confirms it.
  if (created > 0) {
    await new Promise((r) => setTimeout(r, 6000));
    await ingestStream(Date.now() + 25_000).catch(() => undefined);
  }
  await audit({ action: "stream.subscribe", actor: me, target: profileId, detail: { created, failures: failures.length } });
  revalidatePath("/settings/connections");
  if (failures.length) back({ stream_error: `${name}: created ${created}; failed ${failures.join(" | ")}` });
  back({ stream_ok: created > 0 ? `${name}: created ${created} subscription(s)` : `${name}: already subscribed` });
}

/** Re-read an Amazon account's advertising profiles (e.g. after access to a new brand was granted). */
export async function refreshProfiles(form: FormData) {
  const me = await requireAdminAccess();
  if (isDemoMode()) redirect("/settings/connections?error=demo");
  const id = String(form.get("id") ?? "");
  const db = createAdminClient();
  const { data: row } = await db.from("amazon_accounts").select("id, region, refresh_token, name").eq("id", id).maybeSingle();
  if (!row || !isRegion(row.region)) redirect("/settings/connections?error=Account+not+found");
  let found = 0;
  let added = 0;
  try {
    const profiles = await listProfiles({ id: row.id, region: row.region, refresh_token: row.refresh_token });
    found = profiles.length;
    added = await importProfiles(row.id, profiles);
    await db.from("amazon_accounts").update({ last_error: null }).eq("id", id);
  } catch (err) {
    const msg = err instanceof AdsApiError ? `${err.status} ${err.body.slice(0, 200)}` : String(err).slice(0, 200);
    await db.from("amazon_accounts").update({ last_error: `Refresh failed: ${msg}` }).eq("id", id);
    redirect(`/settings/connections?error=${encodeURIComponent(`${row.name}: couldn't refresh profiles (${msg})`)}`);
  }
  revalidatePath("/", "layout");
  redirect(`/settings/connections?${new URLSearchParams({ refreshed: `${row.name}: ${found} profiles found, ${added} new` })}`);
}
