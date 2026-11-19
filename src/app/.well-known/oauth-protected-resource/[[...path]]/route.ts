import { protectedResourceMetadata } from "@/lib/oauth";
import { json, preflight } from "@/lib/oauth/http";

// Served at /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp
export const dynamic = "force-dynamic";
export const GET = () => json(protectedResourceMetadata());
export const OPTIONS = preflight;
