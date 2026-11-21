import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { isAllowedEmail } from "@/lib/env";
import { adminResetPending, clearAdminReset } from "@/lib/password-reset";
import { safeNext } from "@/lib/safe-next";

const TYPES: EmailOtpType[] = ["invite", "recovery", "email", "magiclink", "signup", "email_change"];

/**
 * Uses a one-time invite / reset link — only when the person presses the button on
 * /auth/confirm (a POST), never when a link is merely opened.
 * Password resets only work if an admin started them (Settings → Team → Send password reset).
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "") as EmailOtpType;
  const back = (error: string) => NextResponse.redirect(new URL(`/auth/confirm?error=${error}`, req.url), 303);
  if (!tokenHash || !TYPES.includes(type)) return back("invalid");

  // Invites and resets always continue to choosing a password.
  const next = type === "invite" || type === "recovery" ? "/account/set-password" : safeNext(String(form.get("next") ?? ""));
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet) => toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  });

  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  const user = data.user;
  if (error || !user) {
    await audit({ action: "auth.link_failed", detail: { type, reason: error?.message ?? "no user" } });
    return back("expired");
  }
  const who = { userId: user.id, email: user.email ?? "" };
  if (!isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    return back("domain");
  }
  if (type === "recovery") {
    if (!adminResetPending(user.app_metadata)) {
      // Someone asked Supabase for a reset directly; only admin-started resets are honoured.
      await supabase.auth.signOut();
      await audit({ action: "auth.reset_blocked", actor: who, detail: { reason: "not started by an admin" } });
      return back("not_admin_reset");
    }
    await clearAdminReset(user.id);
  }
  await audit({ action: "auth.sign_in", actor: who, detail: { method: type } });
  return res;
}
