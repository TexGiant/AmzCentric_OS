import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Invite / recovery links: /auth/confirm?token_hash=...&type=invite&next=/account/set-password
 * (set this as the link in Supabase → Auth → Email Templates; see README).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tokenHash = sp.get("token_hash");
  const type = sp.get("type") as EmailOtpType | null;
  const nextParam = sp.get("next") ?? "/account/set-password";
  const next = nextParam.startsWith("/") ? nextParam : "/dashboard";
  if (!tokenHash || !type) return NextResponse.redirect(new URL("/login?error=Invalid+link", req.url));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, req.url));
  if (!isAllowedEmail(data.user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=That+email+domain+is+not+allowed", req.url));
  }
  return NextResponse.redirect(new URL(next, req.url));
}
