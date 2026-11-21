import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { DEMO_USER_COOKIE, demoUser } from "@/lib/demo-users";
import { isDemoMode } from "@/lib/env";
import { ROLES, can, canSeeBrand, isAdmin, type Access, type Perm, type Role } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

/** Roles, brands and team for one person, read with the service role (server only). */
export async function loadAccess(userId: string, email: string): Promise<Access> {
  if (isDemoMode()) {
    const u = demoUser(userId);
    return { ...u, email: u.email };
  }
  const db = createAdminClient();
  const [roles, brands, me, team] = await Promise.all([
    db.from("user_roles").select("role, level").eq("user_id", userId),
    db.from("user_brands").select("brand_slug").eq("user_id", userId),
    db.from("app_users").select("reports_to").eq("user_id", userId).maybeSingle(),
    db.from("app_users").select("user_id, email").eq("reports_to", userId),
  ]);
  if (roles.error || brands.error) throw new Error(`Couldn't load access: ${(roles.error ?? brands.error)!.message}`);
  const rows = (roles.data ?? []) as Array<{ role: string; level: string }>;
  const valid = rows.filter((r) => (ROLES as readonly string[]).includes(r.role));
  return {
    userId,
    email: email.toLowerCase(),
    roles: valid.map((r) => r.role as Role),
    juniorRoles: valid.filter((r) => r.level === "junior").map((r) => r.role as Role),
    brands: (brands.data ?? []).map((b: { brand_slug: string }) => b.brand_slug),
    reportsTo: (me.data?.reports_to as string | null) ?? null,
    team: ((team.data ?? []) as Array<{ user_id: string; email: string }>).map((t) => ({ userId: t.user_id, email: t.email })),
  };
}

/** The signed-in person's access, once per request. Null when signed out. */
export const getAccess = cache(async (): Promise<Access | null> => {
  if (isDemoMode()) {
    const id = (await cookies()).get(DEMO_USER_COOKIE)?.value;
    return { ...demoUser(id) };
  }
  const user = await getUser();
  if (!user) return null;
  return loadAccess(user.id, user.email);
});

export async function requireAccess(): Promise<Access> {
  const a = await getAccess();
  if (!a) redirect("/login");
  return a;
}

/**
 * Server guard for pages and actions: the person must hold `perm` (and see `brand`, if given).
 * Anything else is a 404, so a typed URL reveals nothing. Denials are written to the audit log.
 */
export async function requirePerm(perm: Perm, brand?: string): Promise<Access> {
  const a = await requireAccess();
  if (!can(a, perm, brand)) {
    await audit({ action: "access.denied", brand, target: perm, actor: a });
    notFound();
  }
  return a;
}

export async function requireBrand(brand: string): Promise<Access> {
  const a = await requireAccess();
  if (!canSeeBrand(a, brand)) {
    await audit({ action: "access.denied", brand, target: "brand", actor: a });
    notFound();
  }
  return a;
}

export async function requireAdminAccess(): Promise<Access> {
  const a = await requireAccess();
  if (!isAdmin(a)) {
    await audit({ action: "access.denied", target: "admin", actor: a });
    notFound();
  }
  return a;
}

/** For server actions that return an error instead of a 404 page. */
export class AccessDenied extends Error {
  constructor(message = "You don't have access to do that.") {
    super(message);
  }
}
