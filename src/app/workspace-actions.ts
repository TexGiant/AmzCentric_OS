"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACTION_CATEGORIES } from "@/lib/data/types";

export type FormState = { ok?: boolean; error?: string; message?: string };

const DEMO: FormState = { error: "Demo mode: connect Supabase to save changes." };

export async function addAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (isDemoMode()) return DEMO;
  const brand = String(form.get("brand") ?? "");
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
  revalidatePath(`/dashboard/${brand}`, "layout");
  return { ok: true, message: "Logged." };
}

export async function deleteAction(form: FormData) {
  await requireUser();
  if (isDemoMode()) return;
  const id = String(form.get("id") ?? "");
  const brand = String(form.get("brand") ?? "");
  await createAdminClient().from("action_log").delete().eq("id", id);
  revalidatePath(`/dashboard/${brand}`, "layout");
}

export async function saveGoal(_: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  if (isDemoMode()) return DEMO;
  const brand = String(form.get("brand") ?? "");
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
  revalidatePath(`/dashboard/${brand}`, "layout");
  return { ok: true, message: "Goal saved." };
}
