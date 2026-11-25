// Unit tests for the HR rules (leave policy, balances, attendance, fingerprint log). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_POLICY,
  NO_OPENING,
  balances,
  brandFromPath,
  checkPolicy,
  dayStatus,
  hours,
  localParts,
  normalizePolicy,
  parseAttlog,
  requestDays,
} from "../src/lib/hr/policy.ts";

const P = DEFAULT_POLICY;
const NONE = new Set();
let n = 0;
const req = (over = {}) => ({
  id: `r${++n}`,
  email: "ali@amzcentric.com",
  type: "annual",
  startDate: "2026-12-07",
  endDate: "2026-12-07",
  session: "full",
  days: 1,
  reason: "",
  status: "approved",
  createdAt: "2026-11-01T00:00:00Z",
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  ...over,
});
const ctx = (over = {}) => ({ policy: P, holidays: NONE, today: "2026-11-25", others: [], opening: NO_OPENING, ...over });

// 2026-11-25 is a Wednesday.

test("requestDays counts working days only and a half day as 0.5", () => {
  assert.equal(requestDays(req({ startDate: "2026-11-27", endDate: "2026-12-01" }), P, NONE), 3); // Fri, (Sat, Sun), Mon, Tue
  assert.equal(requestDays(req({ startDate: "2026-11-27", endDate: "2026-12-01" }), P, new Set(["2026-11-30"])), 2);
  assert.equal(requestDays(req({ type: "half_day", session: "am" }), P, NONE), 0.5);
  assert.equal(requestDays(req({ startDate: "2026-11-28", endDate: "2026-11-29" }), P, NONE), 0);
});

test("balances add approved leave to the opening balance; WFH is per month", () => {
  const approved = [
    req({ type: "sick", startDate: "2026-03-27", endDate: "2026-03-27" }),
    req({ type: "annual", startDate: "2026-04-01", endDate: "2026-04-09" }), // 7 working days
    req({ type: "half_day", session: "am", startDate: "2026-04-24", endDate: "2026-04-24" }),
    req({ type: "wfh", startDate: "2026-11-02", endDate: "2026-11-02" }),
    req({ type: "wfh", startDate: "2026-10-05", endDate: "2026-10-05" }),
    req({ type: "casual", startDate: "2026-05-04", endDate: "2026-05-04", status: "declined" }),
  ];
  const b = balances(approved, { sick: 1, casual: 0, annual: 0, half_day: 0 }, P, NONE, "2026-11-25");
  assert.deepEqual(b.sick, { allowed: 8, used: 2, left: 6 });
  assert.deepEqual(b.annual, { allowed: 12, used: 7, left: 5 });
  assert.deepEqual(b.casual, { allowed: 6, used: 0, left: 6 });
  assert.deepEqual(b.half_day, { allowed: 2, used: 1, left: 1 });
  assert.deepEqual(b.wfh, { allowed: 2, used: 1, left: 1 }); // November only
});

test("annual leave needs 3 days' notice, casual 1 day, sick none", () => {
  assert.equal(checkPolicy(req({ type: "annual", startDate: "2026-11-30", endDate: "2026-11-30" }), ctx()).withinPolicy, true);
  const late = checkPolicy(req({ type: "annual", startDate: "2026-11-26", endDate: "2026-11-26" }), ctx());
  assert.equal(late.withinPolicy, false);
  assert.match(late.problems[0], /3 days' notice/);
  assert.equal(checkPolicy(req({ type: "casual", startDate: "2026-11-25", endDate: "2026-11-25" }), ctx()).withinPolicy, false);
  assert.equal(checkPolicy(req({ type: "casual", startDate: "2026-11-26", endDate: "2026-11-26" }), ctx()).withinPolicy, true);
  assert.equal(checkPolicy(req({ type: "sick", startDate: "2026-11-25", endDate: "2026-11-25" }), ctx()).withinPolicy, true);
  assert.equal(checkPolicy(req({ type: "sick", startDate: "2026-11-20", endDate: "2026-11-20" }), ctx()).withinPolicy, true); // logged after
  assert.equal(checkPolicy(req({ type: "sick", startDate: "2026-11-02", endDate: "2026-11-02" }), ctx()).withinPolicy, false); // too long ago
});

test("a request over the balance goes to Zain; pending requests use up the balance too", () => {
  const opening = { sick: 0, casual: 0, annual: 10, half_day: 0 };
  const three = req({ type: "annual", startDate: "2026-12-07", endDate: "2026-12-09" });
  const c = checkPolicy(three, ctx({ opening }));
  assert.equal(c.withinPolicy, false);
  assert.match(c.problems.join(" "), /Only 2 days of annual leave left/);

  const pendingOne = req({ type: "casual", startDate: "2026-12-14", endDate: "2026-12-18", status: "pending" }); // 5 days
  const second = req({ type: "casual", startDate: "2026-12-21", endDate: "2026-12-22" }); // 2 more > 6
  assert.equal(checkPolicy(second, ctx({ others: [pendingOne] })).withinPolicy, false);
  // A declined one doesn't count.
  assert.equal(checkPolicy(second, ctx({ others: [{ ...pendingOne, status: "declined" }] })).withinPolicy, true);
});

test("WFH: 2 days a month, resets each month", () => {
  const used = [req({ type: "wfh", startDate: "2026-11-02", endDate: "2026-11-02" }), req({ type: "wfh", startDate: "2026-11-10", endDate: "2026-11-10" })];
  const third = req({ type: "wfh", startDate: "2026-11-26", endDate: "2026-11-26" });
  assert.equal(checkPolicy(third, ctx({ others: used })).withinPolicy, false);
  const december = req({ type: "wfh", startDate: "2026-12-01", endDate: "2026-12-01" });
  assert.equal(checkPolicy(december, ctx({ others: used })).withinPolicy, true);
});

test("half days: 2 a year, one date, AM or PM; overlaps and 'other' always need Zain", () => {
  const two = [req({ type: "half_day", session: "am", startDate: "2026-04-24", endDate: "2026-04-24" }), req({ type: "half_day", session: "pm", startDate: "2026-06-17", endDate: "2026-06-17" })];
  assert.equal(checkPolicy(req({ type: "half_day", session: "am", startDate: "2026-11-27", endDate: "2026-11-27" }), ctx({ others: two })).withinPolicy, false);
  assert.equal(checkPolicy(req({ type: "half_day", session: "full", startDate: "2026-11-27", endDate: "2026-11-27" }), ctx()).withinPolicy, false);
  const clash = checkPolicy(req({ type: "annual", startDate: "2026-12-07", endDate: "2026-12-08" }), ctx({ others: [req({ type: "casual", startDate: "2026-12-08", endDate: "2026-12-08", status: "pending" })] }));
  assert.match(clash.problems.join(" "), /Overlaps/);
  assert.equal(checkPolicy(req({ type: "other", startDate: "2026-12-07", endDate: "2026-12-07" }), ctx()).withinPolicy, false);
});

test("long sick leave gets a medical-note reminder but stays within policy", () => {
  const c = checkPolicy(req({ type: "sick", startDate: "2026-11-25", endDate: "2026-11-27" }), ctx());
  assert.equal(c.withinPolicy, true);
  assert.match(c.notes[0], /medical note/);
});

const day = (over = {}) => ({
  day: "2026-11-24",
  today: "2026-11-25",
  nowTime: "11:00",
  policy: P,
  holiday: null,
  leave: null,
  punches: [],
  checkIn: null,
  wfhApproved: false,
  ...over,
});

test("office day from fingerprint punches: first in, last out, late after the grace period", () => {
  const r = dayStatus(day({ punches: ["18:05", "09:22", "13:00"] }));
  assert.equal(r.status, "office");
  assert.equal(r.firstIn, "09:22");
  assert.equal(r.lastOut, "18:05");
  assert.equal(r.minutes, 523);
  assert.equal(r.lateBy, 22);
  assert.equal(dayStatus(day({ punches: ["09:15", "18:00"] })).lateBy, null); // within 15 min grace
  assert.deepEqual(dayStatus(day({ punches: ["09:00"] })).flags, ["Only one punch (no punch out)"]);
});

test("WFH day from the app check-in; flagged without an approved request", () => {
  const r = dayStatus(day({ checkIn: { mode: "wfh", inAt: "09:05", outAt: "17:30" } }));
  assert.equal(r.status, "wfh");
  assert.deepEqual(r.flags, ["WFH not approved (yet)"]);
  assert.deepEqual(dayStatus(day({ checkIn: { mode: "wfh", inAt: "09:05", outAt: "17:30" }, wfhApproved: true })).flags, []);
});

test("leave, weekends, holidays, absent and not-in-yet", () => {
  assert.equal(dayStatus(day({ leave: { type: "annual", session: "full" } })).status, "leave");
  assert.equal(dayStatus(day({ day: "2026-11-22" })).status, "weekend"); // Sunday
  assert.equal(dayStatus(day({ holiday: "Iqbal Day" })).status, "holiday");
  assert.equal(dayStatus(day()).status, "absent");
  assert.equal(dayStatus(day({ day: "2026-11-25" })).status, "not_in_yet");
  // AM half day off: coming in at 13:30 is not late.
  const half = dayStatus(day({ leave: { type: "half_day", session: "am" }, punches: ["13:30", "18:00"] }));
  assert.equal(half.status, "office");
  assert.equal(half.lateBy, null);
});

test("parseAttlog reads the machine's tab-separated log and skips junk", () => {
  const text = "        1\t2026-11-24 09:02:11\t1\t0\t1\t0\n       12\t2026-11-24 18:01:00\t1\t1\t0\n\ngarbage line\n3\t2026-02-30 09:00:00\t1\t1\n";
  const { punches, skipped } = parseAttlog(text);
  assert.deepEqual(punches, [
    { deviceUserId: "1", date: "2026-11-24", time: "09:02:11" },
    { deviceUserId: "12", date: "2026-11-24", time: "18:01:00" },
  ]);
  assert.equal(skipped, 2);
});

test("helpers: brand from path, hours, office-local time, policy defaults", () => {
  assert.equal(brandFromPath("/dashboard/geomod/campaigns"), "geomod");
  assert.equal(brandFromPath("/dashboard/geomod"), "geomod");
  assert.equal(brandFromPath("/tasks"), null);
  assert.equal(hours(3 * 3600 + 25 * 60), "3h 25m");
  assert.equal(hours(0), "0m");
  assert.deepEqual(localParts("2026-11-25T04:30:00Z", "Asia/Karachi"), { date: "2026-11-25", time: "09:30" });
  const p = normalizePolicy({ startTime: "25:00", allowance: { sick: 10 }, workDays: [1, 2, 3, 4, 5, 6], timezone: "Mars/Base" });
  assert.equal(p.startTime, "09:00");
  assert.equal(p.allowance.sick, 10);
  assert.equal(p.allowance.casual, 6);
  assert.deepEqual(p.workDays, [1, 2, 3, 4, 5, 6]);
  assert.equal(p.timezone, "Asia/Karachi");
});
