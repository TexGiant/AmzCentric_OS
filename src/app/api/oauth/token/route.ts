import { tokenRequest } from "@/lib/oauth";
import { json, oauthErrorResponse, preflight } from "@/lib/oauth/http";

function basicAuth(req: Request): { id: string; secret: string } | null {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Basic ")) return null;
  const [id, secret] = Buffer.from(h.slice(6), "base64").toString("utf8").split(":");
  return id ? { id: decodeURIComponent(id), secret: decodeURIComponent(secret ?? "") } : null;
}

export async function POST(req: Request) {
  try {
    const type = req.headers.get("content-type") ?? "";
    const form = type.includes("application/json")
      ? new URLSearchParams(Object.entries((await req.json()) as Record<string, string>))
      : new URLSearchParams(await req.text());
    return json(await tokenRequest(form, basicAuth(req)));
  } catch (err) {
    return oauthErrorResponse(err);
  }
}
export const OPTIONS = preflight;
