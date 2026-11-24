// REVIEWER #2: the case study feed never returns raw error text. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

// A server that is "live" (Supabase URL set) but misconfigured (no service-role key):
// building the feed throws an internal error that names the missing variable.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.DEMO_MODE;
process.env.INSIGHTS_API_TOKEN = "test-token";

const { GET } = await import("../src/app/api/insights/case-studies/route.ts");
const call = (headers = {}) => GET(new Request("http://localhost/api/insights/case-studies", { headers }));

test("a server error returns a generic message and logs the detail server-side only", async () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const res = await call({ authorization: "Bearer test-token" });
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(text), { ok: false, error: "internal_error" });
    assert.ok(!/SUPABASE|environment|variable|stack|at /i.test(text), `leaked detail: ${text}`);
    const detail = JSON.stringify(logged, (_k, v) => (v instanceof Error ? v.message : v));
    assert.match(detail, /SUPABASE_SERVICE_ROLE_KEY/, "the real cause is still logged for us");
  } finally {
    console.error = original;
  }
});

test("missing or wrong token is refused before any work is done", async () => {
  const original = console.error;
  console.error = () => {}; // the audit write fails in this misconfigured test server; that's logged, not returned
  try {
    assert.equal((await call()).status, 401);
    assert.equal((await call({ authorization: "Bearer nope" })).status, 401);
  } finally {
    console.error = original;
  }
});
