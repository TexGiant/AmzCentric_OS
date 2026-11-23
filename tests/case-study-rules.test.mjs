// Unit tests for the case study rules. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { anonymizeText, candidateId, qualifies, toCandidate } from "../src/lib/case-study-rules.ts";

const win = (over = {}) => ({ cost: 300, sales: 1000, orders: 40, clicks: 400, impressions: 20000, ...over });
const measured = (before, after, extra = {}) => ({
  actionId: "a1",
  actionDate: "2026-10-20",
  category: "bid",
  description: "Raised exact bids +15% on top 5 keywords",
  campaignId: "c1",
  campaignName: "SP | Exact | Demo Widget",
  adType: "SP",
  afterDays: 14,
  before,
  after,
  ...extra,
});
const brand = { slug: "demo-brand", name: "Demo Brand", category: "Supplements", consent: "anonymized" };

test("sales/day up 15% or more qualifies", () => {
  const q = qualifies(measured(win(), win({ sales: 1200 })));
  assert.equal(q.ok, true);
  assert.match(q.reason, /sales\/day up 20%/);
});

test("ACOS down 5+ points with flat sales qualifies; with a big sales drop it does not", () => {
  assert.equal(qualifies(measured(win(), win({ cost: 240, sales: 980 }))).ok, true); // 30% → 24.5%, sales -2%
  assert.equal(qualifies(measured(win(), win({ cost: 150, sales: 800 }))).ok, false); // ACOS down but sales -20%
});

test("small or incomplete results don't qualify", () => {
  assert.equal(qualifies(measured(win(), win({ sales: 2000 }), { afterDays: 10 })).ok, false); // window not complete
  assert.equal(qualifies(measured(win({ orders: 3 }), win({ sales: 3000 }))).ok, false); // too few orders before
  assert.equal(qualifies(measured(win(), win({ sales: 1050 }))).ok, false); // +5% only
  assert.equal(qualifies(measured(null, null)).ok, false);
});

test("anonymizeText removes brand, campaign, ASIN, SKU, email and links", () => {
  const out = anonymizeText(
    "Demo Brand: paused SP | Exact | Demo Widget for B0CZJ2MSFK (DC-BW-50-2024-04-TW4), see https://x.com/a, asked ali@amzcentric.com",
    { brandNames: ["Demo Brand", "demo-brand"], campaignNames: ["SP | Exact | Demo Widget"] },
  );
  assert.equal(out, "the brand: paused [campaign] for [ASIN] ([SKU]), see [link] asked [email]");
});

test("candidates are anonymized and never come from brands without permission", () => {
  const m = measured(win(), win({ sales: 1300 }), { description: "Demo Brand: raised bids on SP | Exact | Demo Widget" });
  assert.equal(toCandidate(m, { ...brand, consent: "none" }), null);
  const c = toCandidate(m, brand);
  assert.ok(c);
  assert.equal(c.brand, "a Supplements brand");
  assert.equal(c.brand_named, false);
  assert.equal(c.month, "October 2026");
  assert.equal(c.change.what, "the brand: raised bids on [campaign]");
  assert.equal(c.change.scope, "one campaign");
  assert.equal(c.results.sales_per_day_change_pct, 30);
  assert.equal(c.results.acos_before_pct, 30);
  assert.equal(c.results.acos_after_pct, 23.1);
  assert.ok(!JSON.stringify(c).includes("Demo Brand") && !JSON.stringify(c).includes("2026-10-20"));
});

test("other campaigns named in the description are masked too", () => {
  const m = measured(win(), win({ sales: 1300 }), { description: "Moved budget from SB | Video | Hero to SP | Exact | Demo Widget", otherCampaignNames: ["SB | Video | Hero"] });
  assert.equal(toCandidate(m, brand).change.what, "Moved budget from [campaign] to [campaign]");
});

test("named consent keeps the brand name but still hides campaigns and ASINs", () => {
  const m = measured(win(), win({ sales: 1300 }), { description: "Demo Brand bids up on B0CZJ2MSFK" });
  const c = toCandidate(m, { ...brand, consent: "named" });
  assert.equal(c.brand, "Demo Brand");
  assert.equal(c.change.what, "Demo Brand bids up on [ASIN]");
});

test("candidate ids are stable and opaque", () => {
  assert.equal(candidateId("abc"), candidateId("abc"));
  assert.notEqual(candidateId("abc"), candidateId("abd"));
  assert.ok(!candidateId("some-uuid").includes("some-uuid"));
});
