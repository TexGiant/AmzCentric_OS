"use server";

import { revalidatePath } from "next/cache";
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
