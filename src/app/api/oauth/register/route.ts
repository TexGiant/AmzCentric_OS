import { registerClient } from "@/lib/oauth";
import { json, oauthErrorResponse, preflight } from "@/lib/oauth/http";

/** RFC 7591 dynamic client registration (Claude registers itself here). */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return json(await registerClient(body), 201);
  } catch (err) {
    return oauthErrorResponse(err);
  }
}
export const OPTIONS = preflight;
