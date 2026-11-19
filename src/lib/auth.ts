import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { isAllowedEmail, isBootstrapAdmin, isDemoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type SessionUser = { id: string; email: string; role: "admin" | "member" };

export const getUser = cache(async (): Promise<SessionUser | null> => {
  if (isDemoMode()) return { id: "demo", email: "demo@amzcentric.com", role: "admin" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user?.email || !isAllowedEmail(user.email)) return null;

  const admin = createAdminClient();
  const { data: row } = await admin.from("app_users").select("role").eq("user_id", user.id).maybeSingle();
  let role: SessionUser["role"] = row?.role === "admin" ? "admin" : "member";
  if (isBootstrapAdmin(user.email)) role = "admin";
  if (!row || row.role !== role) {
    await admin.from("app_users").upsert({ user_id: user.id, email: user.email, role });
  }
  return { id: user.id, email: user.email, role };
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
