import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { safeNext } from "@/lib/safe-next";

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
  await audit({ action: "auth.sign_in", actor: data.user ? { userId: data.user.id, email: data.user.email ?? "" } : null, detail: { method: "link" } });
  return NextResponse.redirect(new URL(next, req.url));
}
