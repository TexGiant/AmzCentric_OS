"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AdsAccount } from "@/lib/amazon/ads";
import { AdsApiError } from "@/lib/amazon/ads";
import { createStreamSubscription, isLive, listStreamSubscriptions, STREAM_DATASETS } from "@/lib/amazon/stream";
import { ingestStream, streamDestinations } from "@/lib/stream/sqs";
import { requireAdmin, requireUser } from "@/lib/auth";
import { isAllowedEmail, isDemoMode, siteUrl } from "@/lib/env";
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
  await requireUser();
  if (isDemoMode()) return DEMO;
  const name = String(form.get("name") ?? "").trim();
  const slug = slugify(String(form.get("slug") || name));
  if (!name || !slug) return { error: "Enter a brand name." };
  const { error } = await createAdminClient().from("brands").insert({ slug, name });
  if (error) return { error: error.code === "23505" ? "A brand with that slug already exists." : error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: `Created ${name}.` };
}

export async function renameBrand(form: FormData) {
  await requireUser();
  if (isDemoMode()) return;
  const slug = String(form.get("slug"));
  const name = String(form.get("name") ?? "").trim();
  if (name) await createAdminClient().from("brands").update({ name }).eq("slug", slug);
  revalidatePath("/", "layout");
}

export async function deleteBrand(form: FormData) {
  await requireAdmin();
  if (isDemoMode()) return;
  await createAdminClient().from("brands").delete().eq("slug", String(form.get("slug")));
  revalidatePath("/", "layout");
}

// ── Amazon connections ────────────────────────────────────────────────
export async function updateProfile(form: FormData) {
  await requireUser();
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
  revalidatePath("/", "layout");
}

export async function renameAccount(form: FormData) {
  await requireUser();
  if (isDemoMode()) return;
  const name = String(form.get("name") ?? "").trim();
  if (name) await createAdminClient().from("amazon_accounts").update({ name }).eq("id", String(form.get("id")));
  revalidatePath("/settings/connections");
}

export async function disconnectAccount(form: FormData) {
  await requireAdmin();
  if (isDemoMode()) return;
  await createAdminClient().from("amazon_accounts").delete().eq("id", String(form.get("id")));
  revalidatePath("/", "layout");
}

// ── Team ──────────────────────────────────────────────────────────────
export async function inviteMember(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  if (isDemoMode()) return DEMO;
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = form.get("role") === "admin" ? "admin" : "member";
  if (!isAllowedEmail(email)) return { error: "That email domain isn't allowed (see ALLOWED_EMAIL_DOMAINS)." };
  const db = createAdminClient();
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl()}/auth/callback?next=/account/set-password`,
  });
  if (error) return { error: error.message };
  await db.from("app_users").upsert({ user_id: data.user.id, email, role });
  revalidatePath("/settings/team");
  return { ok: true, message: `Invite sent to ${email}.` };
}

export async function setRole(form: FormData) {
  const me = await requireAdmin();
  if (isDemoMode()) return;
  const id = String(form.get("user_id"));
  if (id === me.id) return;
  await createAdminClient()
    .from("app_users")
    .update({ role: form.get("role") === "admin" ? "admin" : "member" })
    .eq("user_id", id);
  revalidatePath("/settings/team");
}

export async function removeMember(form: FormData) {
  const me = await requireAdmin();
  if (isDemoMode()) return;
  const id = String(form.get("user_id"));
  if (id === me.id) return;
  await createAdminClient().auth.admin.deleteUser(id);
  revalidatePath("/settings/team");
}

// ── Marketing Stream subscriptions ───────────────────────────────────
/** Create any missing sp-traffic / sp-conversion subscriptions for one profile, then confirm them. */
export async function subscribeStream(form: FormData) {
  await requireUser();
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

  let created = 0;
  try {
    const existing = await listStreamSubscriptions(account, profileId);
    for (const dataset of STREAM_DATASETS) {
      const arn = destinations[dataset];
      if (!arn) continue;
      if (existing.some((s) => s.dataSetId === dataset && s.destinationArn === arn && isLive(s))) continue;
      await createStreamSubscription(account, profileId, dataset, arn);
      created++;
    }
  } catch (err) {
    const msg = err instanceof AdsApiError ? `${err.message}: ${err.body.slice(0, 300)}` : String(err);
    back({ stream_error: `${name}: ${msg}` });
  }

  // Amazon sends an SNS confirmation message to each queue; reading the queue confirms it.
  if (created > 0) {
    await new Promise((r) => setTimeout(r, 6000));
    await ingestStream(Date.now() + 25_000).catch(() => undefined);
  }
  revalidatePath("/settings/connections");
  back({ stream_ok: created > 0 ? `${name}: created ${created} subscription(s)` : `${name}: already subscribed` });
}
