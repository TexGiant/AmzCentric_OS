import { revokeToken } from "@/lib/oauth";
import { json, preflight } from "@/lib/oauth/http";

/** RFC 7009: always 200, revokes the whole connection the token belongs to. */
export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text());
  const token = form.get("token");
  if (token) await revokeToken(token).catch(() => undefined);
  return json({});
}
export const OPTIONS = preflight;
