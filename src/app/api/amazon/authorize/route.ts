import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { isRegion, REGIONS } from "@/lib/amazon/ads";
import { isDemoMode, requireEnv, siteUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (isDemoMode()) return NextResponse.redirect(new URL("/settings/connections?error=demo", req.url));

  const region = req.nextUrl.searchParams.get("region") ?? "NA";
  if (!isRegion(region)) return NextResponse.json({ error: "Invalid region" }, { status: 400 });

  const state = randomBytes(24).toString("base64url");
  const db = createAdminClient();
  // Opportunistic sweep of expired states.
  await db.from("amazon_oauth_states").delete().lt("expires_at", new Date().toISOString());
  const { error } = await db.from("amazon_oauth_states").insert({
    state,
    user_id: user.id,
    region,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const url = new URL(REGIONS[region].authUrl);
  url.search = new URLSearchParams({
    client_id: requireEnv("AMAZON_ADS_CLIENT_ID"),
    scope: "advertising::campaign_management",
    response_type: "code",
    redirect_uri: `${siteUrl()}/api/amazon/callback`,
    state,
  }).toString();
  return NextResponse.redirect(url);
}
