import { authorizationServerMetadata } from "@/lib/oauth";
import { json, preflight } from "@/lib/oauth/http";

// Some clients look here first; same metadata as oauth-authorization-server.
export const dynamic = "force-dynamic";
export const GET = () => json(authorizationServerMetadata());
export const OPTIONS = preflight;
