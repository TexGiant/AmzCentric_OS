// HR bot API and fingerprint bridge endpoint, run against demo data. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DEMO_MODE = "true";
process.env.HR_API_TOKEN = "hr-test-token";
process.env.ATTENDANCE_TOKEN = "bridge-test-token";

const list = await import("../src/app/api/hr/bot/requests/route.ts");
const one = await import("../src/app/api/hr/bot/requests/[id]/route.ts");
const day = await import("../src/app/api/hr/bot/day/route.ts");
const month = await import("../src/app/api/hr/bot/month/route.ts");
const punches = await import("../src/app/api/hr/punches/route.ts");
const { hrStore } = await import("../src/lib/hr/store.ts");
const { hrContext } = await import("../src/lib/hr/service.ts");
const { addDays } = await import("../src/lib/dates.ts");

const AUTH = { authorization: "Bearer hr-test-token" };
const get = (mod, path, headers = AUTH) => mod.GET(new Request(`http://localhost${path}`, { headers }), { params: Promise.resolve({ id: path.split("/").pop().split("?")[0] }) });
const post = (id, body, headers = AUTH) =>
  one.POST(new Request(`http://localhost/api/hr/bot/requests/${id}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

test("no token or a wrong token is refused", async () => {
  assert.equal((await get(list, "/api/hr/bot/requests", {})).status, 401);
  assert.equal((await get(list, "/api/hr/bot/requests", { authorization: "Bearer nope" })).status, 401);
  assert.equal((await post("x", { action: "approve" }, {})).status, 401);
});

test("pending requests come with the policy check and balances", async () => {
  const res = await get(list, "/api/hr/bot/requests");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.count >= 2);
  for (const r of body.requests) {
    assert.equal(r.status, "pending");
    assert.equal(typeof r.policy.within_policy, "boolean");
    assert.ok(r.balances_now);
  }
});

test("the bot approves within policy, can't approve outside it, escalates with a reason, never declines", async () => {
  const ctx = await hrContext();
  // Annual leave for tomorrow: breaks the 3-day notice rule.
  let start = addDays(ctx.today, 1);
  while (![1, 2, 3, 4, 5].includes(new Date(`${start}T00:00:00Z`).getUTCDay())) start = addDays(start, 1);
  const late = await hrStore().createRequest({ email: "nina@amzcentric.com", type: "annual", startDate: start, endDate: start, session: "full", days: 1, reason: "Wedding" });

  const refused = await post(late.id, { action: "approve" });
  assert.equal(refused.status, 409);
  const rb = await refused.json();
  assert.equal(rb.error, "outside_policy");
  assert.match(rb.problems.join(" "), /notice/);

  assert.equal((await post(late.id, { action: "escalate" })).status, 400); // needs a note
  const esc = await post(late.id, { action: "escalate", note: "Annual leave needs 3 days' notice." });
  assert.equal(esc.status, 200);
  assert.equal((await esc.json()).request.status, "escalated");
  assert.equal((await post(late.id, { action: "approve" })).status, 409); // now Zain's call

  const ok = (await (await get(list, "/api/hr/bot/requests")).json()).requests.find((r) => r.policy.within_policy);
  assert.ok(ok, "demo data has a request within policy");
  const approved = await post(ok.id, { action: "approve", note: "Within policy." });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).request.status, "approved");
  assert.equal((await post(ok.id, { action: "approve" })).status, 409);

  assert.equal((await post(ok.id, { action: "decline", note: "no" })).status, 400);
});

test("day board and month summary", async () => {
  const d = await get(day, "/api/hr/bot/day");
  assert.equal(d.status, 200);
  const db = await d.json();
  assert.ok(db.people.length >= 4);
  assert.ok(db.people.every((p) => typeof p.status === "string" && Array.isArray(p.flags)));
  assert.equal((await get(day, "/api/hr/bot/day?date=nope")).status, 400);

  const m = await get(month, "/api/hr/bot/month");
  assert.equal(m.status, 200);
  const mb = await m.json();
  assert.ok(mb.people.every((p) => p.balances.sick.allowed === 8));
  assert.equal((await get(month, "/api/hr/bot/month?month=2026-13")).status, 400);
});

test("bridge: punches are stored once; bad lines are counted, not stored", async () => {
  const send = (body, headers = { authorization: "Bearer bridge-test-token" }) =>
    punches.POST(new Request("http://localhost/api/hr/punches", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal((await send({ punches: [] }, { authorization: "Bearer hr-test-token" })).status, 401); // the HR token doesn't work here
  const body = {
    device: "K50",
    punches: [
      { user_id: "101", time: "2025-01-06 09:01:00" },
      { user_id: "101", time: "2025-01-06 18:03:10" },
      { user_id: "../x", time: "2025-01-06 09:00:00" },
      { user_id: "102", time: "2025-02-30 09:00:00" },
    ],
    users: [{ user_id: "101", name: "Sara" }],
  };
  const first = await (await send(body)).json();
  assert.deepEqual([first.added, first.invalid, first.users], [2, 2, 1]);
  const again = await (await send(body)).json();
  assert.equal(again.added, 0);
});
