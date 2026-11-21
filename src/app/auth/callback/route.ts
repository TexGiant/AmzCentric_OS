import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { safeNext } from "@/lib/safe-next";
import { adminResetPending, clearAdminReset, sessionMethods } from "@/lib/password-reset";

/** Exchanges a Supabase PKCE code (magic link, password reset, OAuth) for a session. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  if (!code) return NextResponse.redirect(new URL("/login?error=Missing+code", req.url));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, req.url));
  if (!isAllowedEmail(data.user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=That+email+domain+is+not+allowed", req.url));
  }
  // A self-service reset link (requested straight from Supabase) is refused: resets are admin-only.
  if (sessionMethods(data.session?.access_token).includes("recovery")) {
    if (!adminResetPending(data.user?.app_metadata)) {
      await supabase.auth.signOut();
      await audit({ action: "auth.reset_blocked", actor: data.user ? { userId: data.user.id, email: data.user.email ?? "" } : null, detail: { reason: "not started by an admin" } });
      return NextResponse.redirect(new URL("/auth/confirm?error=not_admin_reset", req.url));
    }
    await clearAdminReset(data.user!.id);
  }
  await audit({ action: "auth.sign_in", actor: data.user ? { userId: data.user.id, email: data.user.email ?? "" } : null, detail: { method: "link" } });
  return NextResponse.redirect(new URL(next, req.url));
}
