/*
 * Paths the proxy lets through without a signed-in session. Each of these routes does its
 * own authentication (sign-in pages, cron secret, OAuth / bearer tokens). No imports, so it
 * can be unit-tested directly (tests/public-paths.test.mjs).
 */

/** Everything under these prefixes is public. */
const PUBLIC_PREFIXES = ["/login", "/auth/", "/api/cron/", "/account/set-password", "/.well-known/", "/api/oauth/", "/api/mcp", "/api/meetings/ingest", "/api/hr/bot/"];

/** Only these exact paths are public, so a new route next to them still requires sign-in. */
const PUBLIC_EXACT = ["/api/insights/case-studies", "/api/hr/punches"];

export function isPublicPath(path: string): boolean {
  return PUBLIC_EXACT.includes(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}
