"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { isAllowedEmail, isDemoMode, siteUrl } from "@/lib/env";
import { ROLES, type Role } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";

export type TeamFormState = { ok?: boolean; error?: string; message?: string };

const DEMO: TeamFormState = { error: "Demo mode: sample users can't be changed. Use the “view as” switcher in the sidebar instead." };

function parse(form: FormData) {
  const roles = [...new Set(form.getAll("role").map(String))].filter((r): r is Role => (ROLES as readonly string[]).includes(r));
  const brands = [...new Set(form.getAll("brand").map(String).filter(Boolean))];
  const reportsTo = String(form.get("reports_to") ?? "") || null;
  return { roles, brands, reportsTo };
}

/** Every value must exist: real brands, and a manager who is a brand manager. */
async function validate(db: ReturnType<typeof createAdminClient>, userId: string | null, p: ReturnType<typeof parse>) {
  if (p.roles.length === 0) return "Pick at least one role.";
  if (p.brands.length) {
    const { data } = await db.from("brands").select("slug").in("slug", p.brands);
    if ((data ?? []).length !== p.brands.length) return "One of those brands no longer exists. Refresh and try again.";
  }
  if (p.reportsTo) {
    if (p.reportsTo === userId) return "Someone can't report to themselves.";
    const { data } = await db.from("user_roles").select("role").eq("user_id", p.reportsTo).eq("role", "brand_manager");
    if (!data?.length) return "“Reports to” must be a brand manager.";
  }
  return null;
}

async function adminCount(db: ReturnType<typeof createAdminClient>, excluding?: string) {
  let q = db.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "admin");
  if (excluding) q = q.neq("user_id", excluding);
  const { count } = await q;
  return count ?? 0;
}

async function setAccess(db: ReturnType<typeof createAdminClient>, userId: string, p: ReturnType<typeof parse>) {
  // Replace roles and brands with exactly what was submitted.
  const delRoles = db.from("user_roles").delete().eq("user_id", userId);
  const { error: e1 } = p.roles.length ? await delRoles.not("role", "in", `(${p.roles.join(",")})`) : await delRoles;
  if (e1) throw new Error(e1.message);
  if (p.roles.length) {
    const { error } = await db.from("user_roles").upsert(p.roles.map((role) => ({ user_id: userId, role })), { onConflict: "user_id,role", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const delBrands = db.from("user_brands").delete().eq("user_id", userId);
  const { error: e2 } = p.brands.length ? await delBrands.not("brand_slug", "in", `(${p.brands.map((b) => `"${b}"`).join(",")})`) : await delBrands;
  if (e2) throw new Error(e2.message);
  if (p.brands.length) {
    const { error } = await db.from("user_brands").upsert(p.brands.map((brand_slug) => ({ user_id: userId, brand_slug })), { onConflict: "user_id,brand_slug", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const { error: e3 } = await db.from("app_users").update({ reports_to: p.reportsTo }).eq("user_id", userId);
  if (e3) throw new Error(e3.message);
}

export async function inviteMember(_: TeamFormState, form: FormData): Promise<TeamFormState> {
  const me = await requireAdminAccess();
  if (isDemoMode()) return DEMO;
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const p = parse(form);
  if (!isAllowedEmail(email)) return { error: "That email domain isn't allowed (see ALLOWED_EMAIL_DOMAINS)." };
  const db = createAdminClient();
  const bad = await validate(db, null, p);
  if (bad) return { error: bad };
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl()}/auth/callback?next=/account/set-password`,
  });
  if (error) return { error: error.message };
  const userId = data.user.id;
  const { error: upErr } = await db.from("app_users").upsert({ user_id: userId, email, rbac_seeded: true });
  if (upErr) return { error: upErr.message };
  try {
    await setAccess(db, userId, p);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save roles." };
  }
  await audit({ action: "team.invite", actor: me, target: email, detail: { roles: p.roles, brands: p.brands, reports_to: p.reportsTo } });
  revalidatePath("/settings/team");
  return { ok: true, message: `Invite sent to ${email}.` };
}

export async function saveMember(_: TeamFormState, form: FormData): Promise<TeamFormState> {
  const me = await requireAdminAccess();
  if (isDemoMode()) return DEMO;
  const userId = String(form.get("user_id") ?? "");
  const p = parse(form);
  const db = createAdminClient();
  const { data: target } = await db.from("app_users").select("email, reports_to").eq("user_id", userId).maybeSingle();
  if (!target) return { error: "That person no longer exists." };
  const bad = await validate(db, userId, p);
  if (bad) return { error: bad };

  const [{ data: oldRoles }, { data: oldBrands }] = await Promise.all([
    db.from("user_roles").select("role").eq("user_id", userId),
    db.from("user_brands").select("brand_slug").eq("user_id", userId),
  ]);
  const wasAdmin = (oldRoles ?? []).some((r: { role: string }) => r.role === "admin");
  if (wasAdmin && !p.roles.includes("admin") && (await adminCount(db, userId)) === 0) {
    return { error: "There must always be at least one admin. Make someone else an admin first." };
  }
  try {
    await setAccess(db, userId, p);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save." };
  }
  await audit({
    action: "team.access",
    actor: me,
    target: target.email,
    detail: {
      roles: { from: (oldRoles ?? []).map((r: { role: string }) => r.role).sort(), to: [...p.roles].sort() },
      brands: { from: (oldBrands ?? []).map((b: { brand_slug: string }) => b.brand_slug).sort(), to: [...p.brands].sort() },
      reports_to: { from: target.reports_to, to: p.reportsTo },
    },
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved." };
}

export async function removeMember(form: FormData) {
  const me = await requireAdminAccess();
  if (isDemoMode()) return;
  const id = String(form.get("user_id"));
  if (id === me.userId) return;
  const db = createAdminClient();
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", id);
  if ((roles ?? []).some((r: { role: string }) => r.role === "admin") && (await adminCount(db, id)) === 0) return;
  const { data: target } = await db.from("app_users").select("email").eq("user_id", id).maybeSingle();
  await db.auth.admin.deleteUser(id); // cascades to app_users, roles, brands, Claude tokens
  await audit({ action: "team.remove", actor: me, target: target?.email ?? id });
  revalidatePath("/settings/team");
}
