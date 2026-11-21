import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_USER_COOKIE, demoUser } from "@/lib/demo-users";
import { isAllowedEmail, isBootstrapAdmin, isDemoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type SessionUser = { id: string; email: string; role: "admin" | "member" };

export const getUser = cache(async (): Promise<SessionUser | null> => {
  if (isDemoMode()) {
    // Demo: whoever is picked in the sidebar's "view as" switcher.
    const u = demoUser((await cookies()).get(DEMO_USER_COOKIE)?.value);
    return { id: u.userId, email: u.email, role: u.roles.includes("admin") ? "admin" : "member" };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user?.email || !isAllowedEmail(user.email)) return null;

  // Roles live in user_roles (migration 0007). A first sign-in creates the app_users row
  // with no roles: default deny until an admin assigns roles and brands.
  const admin = createAdminClient();
  const [{ data: row }, { data: roles }] = await Promise.all([
    admin.from("app_users").select("user_id").eq("user_id", user.id).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", user.id),
  ]);
  if (!row) await admin.from("app_users").upsert({ user_id: user.id, email: user.email.toLowerCase() });
  let isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
  if (!isAdmin && isBootstrapAdmin(user.email)) {
    await admin.from("user_roles").upsert({ user_id: user.id, role: "admin" });
    isAdmin = true;
  }
  return { id: user.id, email: user.email.toLowerCase(), role: isAdmin ? "admin" : "member" };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (user) return user;
  if (!isDemoMode()) {
    const { data } = await (await createClient()).auth.getUser();
    const email = data.user?.email;
    if (email && !isAllowedEmail(email)) {
      redirect(`/login?error=${encodeURIComponent(`${email} isn't allowed to use AmzCentric OS. Sign in with your work email.`)}`);
    }
  }
  redirect("/login");
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}
