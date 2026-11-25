import "server-only";
import { eachDay } from "@/lib/dates";
import {
  LEAVE_TYPES,
  NO_OPENING,
  SESSIONS,
  balances,
  checkPolicy,
  dayStatus,
  localParts,
  requestDays,
  toMinutes,
  type Balances,
  type DayResult,
  type HrPolicy,
  type LeaveRequest,
  type LeaveType,
  type Opening,
  type PolicyCheck,
  type RequestStatus,
  type Session,
} from "@/lib/hr/policy";
import { hrStore, type CheckInRow, type Holiday, type HrStore } from "@/lib/hr/store";

/*
 * HR operations shared by the app pages, server actions and the HR bot API.
 * Callers check who may do what; this module applies the HR rules.
 */

export type HrCtx = {
  store: HrStore;
  policy: HrPolicy;
  holidays: Holiday[];
  holidaySet: Set<string>;
  today: string;
  nowTime: string;
};

export async function hrContext(): Promise<HrCtx> {
  const store = hrStore();
  const [policy, holidays] = await Promise.all([store.getPolicy(), store.listHolidays()]);
  const { date, time } = localParts(new Date(), policy.timezone);
  return { store, policy, holidays, holidaySet: new Set(holidays.map((h) => h.day)), today: date, nowTime: time };
}

export type Person = {
  email: string;
  name: string;
  displayName: string | null;
  deviceUserId: string | null;
  tracked: boolean;
  admin: boolean;
  /** Leave taken before the app, for the current year (zeros for other years). */
  opening: Opening;
  openingYear: number | null;
};

const nameFromEmail = (email: string) => {
  const local = email.split("@")[0].replace(/[._-]+/g, " ");
  return local.replace(/\b\w/g, (c) => c.toUpperCase());
};

/** Everyone with an app account, with their HR settings. Admins aren't tracked unless turned on. */
export async function listPeople(ctx: HrCtx): Promise<Person[]> {
  const [team, rows] = await Promise.all([ctx.store.team(), ctx.store.listPeople()]);
  const byEmail = new Map(rows.map((r) => [r.email.toLowerCase(), r]));
  const year = Number(ctx.today.slice(0, 4));
  return team
    .map((t) => {
      const r = byEmail.get(t.email);
      return {
        email: t.email,
        name: r?.displayName?.trim() || nameFromEmail(t.email),
        displayName: r?.displayName ?? null,
        deviceUserId: r?.deviceUserId ?? null,
        tracked: r ? r.tracked : !t.admin,
        admin: t.admin,
        opening: r && r.openingYear === year ? r.opening : NO_OPENING,
        openingYear: r?.openingYear ?? null,
      };
    })
    .sort((a, b) => Number(b.tracked) - Number(a.tracked) || a.name.localeCompare(b.name));
}

export async function findPerson(ctx: HrCtx, email: string): Promise<Person | null> {
  return (await listPeople(ctx)).find((p) => p.email === email.toLowerCase()) ?? null;
}

// ── Leave ───────────────────────────────────────────────────────────────

export async function personBalances(ctx: HrCtx, p: Person, month = ctx.today): Promise<Balances> {
  const y = month.slice(0, 4);
  const approved = await ctx.store.listRequests({ email: p.email, statuses: ["approved"], from: `${y}-01-01`, to: `${y}-12-31` });
  return balances(approved, y === ctx.today.slice(0, 4) ? p.opening : NO_OPENING, ctx.policy, ctx.holidaySet, month);
}

export async function checkRequest(ctx: HrCtx, p: Person, r: Pick<LeaveRequest, "id" | "type" | "startDate" | "endDate" | "session">): Promise<PolicyCheck> {
  const from = `${Number(r.startDate.slice(0, 4))}-01-01`;
  const to = `${Number(r.endDate.slice(0, 4))}-12-31`;
  const others = await ctx.store.listRequests({ email: p.email, from, to, limit: 1000 });
  return checkPolicy(r, { policy: ctx.policy, holidays: ctx.holidaySet, today: ctx.today, others, opening: p.opening });
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export type LeaveInput = { type: string; startDate: string; endDate: string; session: string; reason: string };

/** Validates and stores a new request (status "pending" for HR). */
export async function createLeave(ctx: HrCtx, p: Person, input: LeaveInput): Promise<{ request: LeaveRequest; check: PolicyCheck } | { error: string }> {
  const type = input.type as LeaveType;
  if (!LEAVE_TYPES.includes(type)) return { error: "Pick a leave type." };
  const session = (type === "half_day" ? input.session : "full") as Session;
  if (!SESSIONS.includes(session) || (type === "half_day" && session === "full")) return { error: "Pick AM or PM for a half day." };
  const startDate = input.startDate;
  const endDate = type === "half_day" ? startDate : input.endDate || startDate;
  if (!YMD.test(startDate) || !YMD.test(endDate)) return { error: "Pick the dates." };
  if (endDate < startDate) return { error: "The last day is before the first day." };
  if (endDate > `${Number(ctx.today.slice(0, 4)) + 1}-12-31`) return { error: "That's too far ahead." };
  const reason = input.reason.trim().slice(0, 500);
  if (type !== "wfh" && type !== "sick" && reason.length < 3) return { error: "Add a short reason." };
  const days = requestDays({ type, startDate, endDate }, ctx.policy, ctx.holidaySet);
  if (days === 0) return { error: "Those dates are all weekends or holidays." };
  const draft = { id: "new", type, startDate, endDate, session };
  const check = await checkRequest(ctx, p, draft);
  if (check.problems.some((x) => x.startsWith("Overlaps"))) return { error: check.problems.find((x) => x.startsWith("Overlaps"))! };
  const request = await ctx.store.createRequest({ email: p.email, type, startDate, endDate, session, days, reason });
  return { request, check };
}

export type Decision = "approve" | "decline" | "escalate" | "cancel";
export type Decider = { kind: "bot" } | { kind: "admin"; email: string } | { kind: "self"; email: string };
export type DecideResult = { ok: true; request: LeaveRequest } | { ok: false; status: number; error: string; problems?: string[] };

/**
 * Who may do what:
 * - HR bot: approve a pending request only when it fits the policy; otherwise escalate it to Zain.
 * - Admin: approve or decline anything pending or escalated; cancel an approved one.
 * - The person themselves: cancel their own request while it's waiting.
 */
export async function decide(ctx: HrCtx, id: string, action: Decision, by: Decider, note: string | null): Promise<DecideResult> {
  const r = await ctx.store.getRequest(id);
  if (!r) return { ok: false, status: 404, error: "Request not found." };
  const cleanNote = note?.trim().slice(0, 500) || null;
  let from: RequestStatus[];
  let to: RequestStatus;

  if (by.kind === "bot") {
    if (action === "approve") {
      if (r.status !== "pending") return { ok: false, status: 409, error: `Only pending requests can be approved by HR (this one is ${r.status}).` };
      const p = await findPerson(ctx, r.email);
      if (!p) return { ok: false, status: 409, error: "This person no longer has an account." };
      const check = await checkRequest(ctx, p, r);
      if (!check.withinPolicy) return { ok: false, status: 409, error: "outside_policy", problems: check.problems };
      from = ["pending"];
      to = "approved";
    } else if (action === "escalate") {
      if (r.status !== "pending") return { ok: false, status: 409, error: `Only pending requests can be escalated (this one is ${r.status}).` };
      from = ["pending"];
      to = "escalated";
    } else {
      return { ok: false, status: 403, error: "HR can approve requests within policy or escalate them to Zain; only Zain declines." };
    }
  } else if (by.kind === "admin") {
    if (action === "approve" || action === "decline") {
      from = ["pending", "escalated"];
      to = action === "approve" ? "approved" : "declined";
    } else if (action === "cancel") {
      from = ["pending", "escalated", "approved"];
      to = "cancelled";
    } else {
      return { ok: false, status: 400, error: "Unknown action." };
    }
  } else {
    if (action !== "cancel" || r.email !== by.email.toLowerCase()) return { ok: false, status: 403, error: "You can only cancel your own request." };
    from = ["pending", "escalated"];
    to = "cancelled";
  }

  const updated = await ctx.store.updateRequest(
    id,
    { status: to, decidedBy: by.kind === "bot" ? "hr-bot" : by.email, decidedAt: new Date().toISOString(), decisionNote: cleanNote },
    from,
  );
  if (!updated) return { ok: false, status: 409, error: `This request is already ${(await ctx.store.getRequest(id))?.status ?? "gone"}.` };
  return { ok: true, request: updated };
}

// ── Check-in ────────────────────────────────────────────────────────────

/**
 * Check in for today. Working from home without an approved or waiting WFH request files one
 * automatically, so HR sees it and the monthly allowance is counted.
 */
export async function checkIn(ctx: HrCtx, p: Person, mode: "office" | "wfh"): Promise<{ checkIn: CheckInRow; filed: LeaveRequest | null }> {
  const row = await ctx.store.checkIn(p.email, ctx.today, mode);
  let filed: LeaveRequest | null = null;
  if (row.mode === "wfh") {
    const live = await ctx.store.listRequests({ email: p.email, statuses: ["pending", "escalated", "approved"], from: ctx.today, to: ctx.today });
    if (!live.some((r) => r.type === "wfh")) {
      const res = await createLeave(ctx, p, { type: "wfh", startDate: ctx.today, endDate: ctx.today, session: "full", reason: "Checked in as WFH" });
      if ("request" in res) filed = res.request;
    }
  }
  return { checkIn: row, filed };
}

// ── Attendance ──────────────────────────────────────────────────────────

export type DayRow = { day: string; person: Person; result: DayResult; appSeconds: number; checkIn: CheckInRow | null };

/** Attendance for each tracked person (or one person) and each day from…to. */
export async function attendance(ctx: HrCtx, from: string, to: string, only?: Person[]): Promise<DayRow[]> {
  const people = only ?? (await listPeople(ctx)).filter((p) => p.tracked);
  const [punches, checkins, requests, time] = await Promise.all([
    ctx.store.listPunches(from, to),
    ctx.store.listCheckins(from, to),
    ctx.store.listRequests({ statuses: ["approved"], from, to, limit: 5000 }),
    ctx.store.appTime(from, to),
  ]);
  const holidayName = new Map(ctx.holidays.map((h) => [h.day, h.name]));
  const punchMap = new Map<string, string[]>();
  for (const x of punches) {
    const k = `${x.deviceUserId}|${x.date}`;
    punchMap.set(k, [...(punchMap.get(k) ?? []), x.time.slice(0, 5)]);
  }
  const secs = new Map<string, number>();
  for (const t of time) secs.set(`${t.email}|${t.day}`, (secs.get(`${t.email}|${t.day}`) ?? 0) + t.seconds);
  const out: DayRow[] = [];
  for (const p of people) {
    const mine = requests.filter((r) => r.email === p.email);
    for (const day of eachDay(from, to)) {
      const covering = mine.filter((r) => r.startDate <= day && r.endDate >= day);
      const leave = covering.find((r) => r.type !== "wfh") ?? null;
      const ci = checkins.find((c) => c.email === p.email && c.day === day) ?? null;
      const ciLocal = ci ? { mode: ci.mode, inAt: localParts(ci.checkedInAt, ctx.policy.timezone).time, outAt: ci.checkedOutAt ? localParts(ci.checkedOutAt, ctx.policy.timezone).time : null } : null;
      const result = dayStatus({
        day,
        today: ctx.today,
        nowTime: ctx.nowTime,
        policy: ctx.policy,
        holiday: holidayName.get(day) ?? null,
        leave: leave ? { type: leave.type, session: leave.session } : null,
        punches: p.deviceUserId ? (punchMap.get(`${p.deviceUserId}|${day}`) ?? []) : [],
        checkIn: ciLocal,
        wfhApproved: covering.some((r) => r.type === "wfh"),
      });
      out.push({ day, person: p, result, appSeconds: secs.get(`${p.email}|${day}`) ?? 0, checkIn: ci });
    }
  }
  return out;
}

export type PersonSummary = {
  person: Person;
  office: number;
  wfh: number;
  leave: number;
  absent: number;
  late: number;
  /** Average first-in time on days present, "HH:MM". */
  avgIn: string | null;
  /** Average minutes between first in and last out on complete days. */
  avgMinutes: number | null;
  appSeconds: number;
  flags: number;
};

export function summarize(rows: DayRow[]): PersonSummary[] {
  const by = new Map<string, DayRow[]>();
  for (const r of rows) by.set(r.person.email, [...(by.get(r.person.email) ?? []), r]);
  return [...by.values()].map((rs) => {
    const present = rs.filter((r) => r.result.status === "office" || r.result.status === "wfh");
    const ins = present.map((r) => r.result.firstIn).filter((x): x is string => !!x).map(toMinutes);
    const spans = present.map((r) => r.result.minutes).filter((x): x is number => x != null && x > 0);
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
    const avgInMin = avg(ins);
    return {
      person: rs[0].person,
      office: rs.filter((r) => r.result.status === "office").length,
      wfh: rs.filter((r) => r.result.status === "wfh").length,
      leave: rs.filter((r) => r.result.leave && r.result.leave.type !== "wfh").reduce((s, r) => s + (r.result.leave!.type === "half_day" ? 0.5 : 1), 0),
      absent: rs.filter((r) => r.result.status === "absent").length,
      late: rs.filter((r) => r.result.lateBy != null).length,
      avgIn: avgInMin == null ? null : `${String(Math.floor(avgInMin / 60)).padStart(2, "0")}:${String(avgInMin % 60).padStart(2, "0")}`,
      avgMinutes: avg(spans),
      appSeconds: rs.reduce((s, r) => s + r.appSeconds, 0),
      flags: rs.reduce((s, r) => s + r.result.flags.length, 0),
    };
  });
}

/** Display name for each email (for request lists). */
export function namesOf(people: Person[]): Record<string, string> {
  return Object.fromEntries(people.map((p) => [p.email, p.name]));
}
