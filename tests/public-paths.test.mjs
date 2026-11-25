// REVIEWER #1: only the exact case study path skips the login check. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicPath } from "../src/lib/public-paths.ts";

test("the case study feed is public (it checks its own bearer token)", () => {
  assert.equal(isPublicPath("/api/insights/case-studies"), true);
});

test("every other /api/insights path still requires login", () => {
  for (const p of ["/api/insights/", "/api/insights", "/api/insights/other", "/api/insights/case-studies-admin", "/api/insights/case-studies/x", "/api/insights/case-studiesx"]) {
    assert.equal(isPublicPath(p), false, p);
  }
});

test("existing public routes are unchanged and app pages require login", () => {
  for (const p of ["/login", "/auth/confirm", "/auth/verify", "/api/cron/poll-reports", "/api/oauth/token", "/api/mcp", "/.well-known/oauth-authorization-server", "/api/meetings/ingest", "/account/set-password"]) {
    assert.equal(isPublicPath(p), true, p);
  }
  for (const p of ["/", "/dashboard", "/dashboard/x/campaigns", "/settings/team", "/api/backfill", "/api/poll"]) {
    assert.equal(isPublicPath(p), false, p);
  }
});

test("the HR bot API and the fingerprint bridge check their own tokens; the heartbeat needs a login", () => {
  for (const p of ["/api/hr/bot/requests", "/api/hr/bot/requests/123", "/api/hr/bot/day", "/api/hr/bot/month", "/api/hr/punches"]) {
    assert.equal(isPublicPath(p), true, p);
  }
  for (const p of ["/api/hr/heartbeat", "/api/hr", "/api/hr/bot", "/api/hr/punches/x", "/api/hr/punchesx", "/hr", "/me", "/settings/hr"]) {
    assert.equal(isPublicPath(p), false, p);
  }
});
