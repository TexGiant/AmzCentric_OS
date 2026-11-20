import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { exchangeAuthCode, isRegion, listProfiles, type AdsAccount } from "@/lib/amazon/ads";
import { encryptSecret } from "@/lib/crypto";
import { importProfiles } from "@/lib/amazon/profiles";
import { siteUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

function back(req: NextRequest, params: Record<string, string>) {
  return NextResponse.redirect(new URL(`/settings/connections?${new URLSearchParams(params)}`, req.url));
}

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back(req, { error: sp.get("error_description") ?? sp.get("error")! });
  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state) return back(req, { error: "Missing code or state" });

  const db = createAdminClient();
  // Consume the state (single use) and verify it belongs to this user and hasn't expired.
  const { data: row } = await db.from("amazon_oauth_states").delete().eq("state", state).select().maybeSingle();
  if (!row || row.user_id !== user.id || Date.parse(row.expires_at) < Date.now() || !isRegion(row.region)) {
    return back(req, { error: "Sign-in link expired. Please try again." });
  }

  try {
    const tokens = await exchangeAuthCode(row.region, code, `${siteUrl()}/api/amazon/callback`);
    if (!tokens.refresh_token) throw new Error("Amazon did not return a refresh token");

    const encrypted = encryptSecret(tokens.refresh_token);
    const temp: AdsAccount = { id: "new", region: row.region, refresh_token: encrypted };
    const profiles = await listProfiles(temp, tokens.access_token);
    const name = profiles[0]?.accountInfo?.name ?? `Amazon ${row.region}`;

    const { data: account, error } = await db
      .from("amazon_accounts")
      .insert({ name, region: row.region, refresh_token: encrypted, connected_by: user.id })
      .select("id")
      .single();
    if (error) throw error;

    // Re-connecting moves existing profiles to the new account but keeps brand/enabled settings.
    await importProfiles(account.id, profiles);
    return back(req, { connected: String(profiles.length) });
  } catch (err) {
    return back(req, { error: err instanceof Error ? err.message : String(err) });
  }
}
