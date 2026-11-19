import "server-only";
import { NextResponse } from "next/server";
import { OAuthError } from "@/lib/oauth";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store", ...headers } });
}

export function oauthErrorResponse(err: unknown) {
  if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, err.status);
  console.error("oauth error", err);
  return json({ error: "server_error", error_description: "Unexpected error" }, 500);
}

export const preflight = () => new Response(null, { status: 204, headers: CORS });
