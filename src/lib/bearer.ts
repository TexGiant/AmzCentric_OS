import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/** True when the request carries `Authorization: Bearer <value of env var>` (constant-time compare). */
export function bearerMatches(req: Request, envName: string): boolean {
  const expected = process.env[envName];
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
