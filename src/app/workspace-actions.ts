"use server";

import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { allowedActionCategories, can } from "@/lib/rbac";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACTION_CATEGORIES, type ActionCategory } from "@/lib/data/types";

export type FormState = { ok?: boolean; error?: string; message?: string };

const DEMO: FormState = { error: "Demo mode: connect Supabase to save changes." };

const NO: FormState = { error: "You don't have access to do that." };

export async function addAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireAccess();
  const brand = String(form.get("brand") ?? "");
  if (!can(user, "actions.log", brand)) return NO;
  if (!allowedActionCategories(user, ACTION_CATEGORIES.map((c) => c.value)).includes(String(form.get("category")) as ActionCategory))
    return { error: "Your role can't log that category." };
  if (isDemoMode()) return DEMO;
  const category = String(form.get("category") ?? "");
  const description = String(form.get("description") ?? "").trim();
  const actionDate = String(form.get("action_date") ?? "");
  const campaign = String(form.get("campaign") ?? "");
  if (!brand || !description || !/^\d{4}-\d{2}-\d{2}$/.test(actionDate)) return { error: "Date and description are required." };
  if (!ACTION_CATEGORIES.some((c) => c.value === category)) return { error: "Pick a category." };
  const [campaignId, ...nameParts] = campaign ? campaign.split("::") : [];
  const { error } = await createAdminClient()
    .from("action_log")
    .insert({
      brand_slug: brand,
      category,
      description,
      action_date: actionDate,
      campaign_id: campaignId || null,
      campaign_name: nameParts.join("::") || null,
      author_email: user.email,
    });
  if (error) return { error: error.message };
  await audit({ action: "action.create", actor: user, brand, target: campaignId || null, detail: { category, description, action_date: actionDate } });
  revalidatePath(`/dashboard/${brand}`, "layout");
  return { ok: true, message: "Logged." };
}

export async function deleteAction(form: FormData) {
  const user = await requireAccess();
  const id = String(form.get("id") ?? "");
  if (isDemoMode()) return;
  const db = createAdminClient();
  // The brand comes from the row itself, never from the form.
  const { data: row } = await db.from("action_log").select("brand_slug, author_email, description").eq("id", id).maybeSingle();
  if (!row || !can(user, "actions.log", row.brand_slug)) return;
  // Managers can remove any entry on their brands; others only their own.
  if (!can(user, "tasks.team", row.brand_slug) && row.author_email?.toLowerCase() !== user.email) return;
  const brand = row.brand_slug as string;
  await db.from("action_log").delete().eq("id", id);
  await audit({ action: "action.delete", actor: user, brand, target: id, detail: { description: row.description } });
  revalidatePath(`/dashboard/${brand}`, "layout");
}

export async function saveGoal(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireAccess();
  const brand = String(form.get("brand") ?? "");
  if (!can(user, "goals.edit", brand)) return NO;
  if (isDemoMode()) return DEMO;
  const month = String(form.get("month") ?? "");
  const num = (k: string) => {
    const v = String(form.get(k) ?? "").replace(/[$,%\s]/g, "");
    return v === "" ? null : Number(v);
  };
  const acos = num("acos_target");
  if (!/^\d{4}-\d{2}-01$/.test(month)) return { error: "Invalid month." };
  const { error } = await createAdminClient()
    .from("goals")
    .upsert({
      brand_slug: brand,
      month,
      sales_target: num("sales_target"),
      spend_budget: num("spend_budget"),
      acos_target: acos == null ? null : acos > 1 ? acos / 100 : acos,
      updated_at: new Date().toISOString(),
    });
  if (error) return { error: error.message };
  await audit({ action: "goal.save", actor: user, brand, target: month, detail: { sales_target: num("sales_target"), spend_budget: num("spend_budget"), acos_target: acos } });
  revalidatePath(`/dashboard/${brand}`, "layout");
  return { ok: true, message: "Goal saved." };
}
