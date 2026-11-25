/*
 * HR rules for AmzCentric OS: leave policy, balances, attendance status and the
 * fingerprint machine's log format. Pure (no server imports) so pages, the HR bot API
 * and tests all use the same rules.
 *
 * Times are office-local "HH:MM" strings and dates are "YYYY-MM-DD" in the office
 * timezone (Asia/Karachi by default), so there is no timezone math outside this file.
 */

import { daysBetween, daysInMonth, eachDay } from "@/lib/dates";

// ── Leave types and policy ──────────────────────────────────────────────

export const LEAVE_TYPES = ["sick", "casual", "annual", "half_day", "wfh", "other"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_LABELS: Record<LeaveType, string> = {
  sick: "Sick",
  casual: "Casual",
  annual: "Annual",
  half_day: "Half day",
  wfh: "Work from home",
  other: "Other / unpaid",
};

export const SESSIONS = ["full", "am", "pm"] as const;
export type Session = (typeof SESSIONS)[number];

export const REQUEST_STATUSES = ["pending", "escalated", "approved", "declined", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "Waiting for HR",
  escalated: "Waiting for Zain",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
};

export type HrPolicy = {
  /** Office timezone (IANA). */
  timezone: string;
  /** Working weekdays, 0 = Sunday … 6 = Saturday. */
  workDays: number[];
  /** Office hours, "HH:MM". */
  startTime: string;
  endTime: string;
  /** Minutes after the start time before a check-in counts as late. */
  graceMinutes: number;
  /** Per year: days for sick/casual/annual, number of half days for half_day. Per month for WFH. */
  allowance: { sick: number; casual: number; annual: number; half_day: number; wfh_per_month: number };
  /** Days of notice needed before the first day off. */
  noticeDays: { sick: number; casual: number; annual: number; half_day: number; wfh: number };
  /** Sick leave longer than this many working days: HR may ask for a medical note. */
  sickNoteAfterDays: number;
  /** Sick leave can be logged this many days after the fact. */
  sickBackdateDays: number;
  /** No mouse or keyboard for this long and app time stops counting. */
  idleMinutes: number;
};

/** AmzCentric's leave policy (the "How To Use" sheet): 8 sick, 6 casual, 12 annual, 2 half days a year, 2 WFH days a month. */
export const DEFAULT_POLICY: HrPolicy = {
  timezone: "Asia/Karachi",
  workDays: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "18:00",
  graceMinutes: 15,
  allowance: { sick: 8, casual: 6, annual: 12, half_day: 2, wfh_per_month: 2 },
  noticeDays: { sick: 0, casual: 1, annual: 3, half_day: 0, wfh: 0 },
  sickNoteAfterDays: 2,
  sickBackdateDays: 7,
  idleMinutes: 5,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** A stored policy merged over the defaults; anything missing or invalid falls back. */
export function normalizePolicy(raw: unknown): HrPolicy {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof HrPolicy, unknown>>;
  const d = DEFAULT_POLICY;
  const al = (r.allowance && typeof r.allowance === "object" ? r.allowance : {}) as Record<string, unknown>;
  const no = (r.noticeDays && typeof r.noticeDays === "object" ? r.noticeDays : {}) as Record<string, unknown>;
  const tz = typeof r.timezone === "string" && validTimezone(r.timezone) ? r.timezone : d.timezone;
  const days = Array.isArray(r.workDays) ? [...new Set(r.workDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : d.workDays;
  return {
    timezone: tz,
    workDays: days.length ? days : d.workDays,
    startTime: typeof r.startTime === "string" && HHMM.test(r.startTime) ? r.startTime : d.startTime,
    endTime: typeof r.endTime === "string" && HHMM.test(r.endTime) ? r.endTime : d.endTime,
    graceMinutes: clampInt(r.graceMinutes, 0, 180, d.graceMinutes),
    allowance: {
      sick: clampInt(al.sick, 0, 60, d.allowance.sick),
      casual: clampInt(al.casual, 0, 60, d.allowance.casual),
      annual: clampInt(al.annual, 0, 60, d.allowance.annual),
      half_day: clampInt(al.half_day, 0, 60, d.allowance.half_day),
      wfh_per_month: clampInt(al.wfh_per_month, 0, 31, d.allowance.wfh_per_month),
    },
    noticeDays: {
      sick: clampInt(no.sick, 0, 60, d.noticeDays.sick),
      casual: clampInt(no.casual, 0, 60, d.noticeDays.casual),
      annual: clampInt(no.annual, 0, 60, d.noticeDays.annual),
      half_day: clampInt(no.half_day, 0, 60, d.noticeDays.half_day),
      wfh: clampInt(no.wfh, 0, 60, d.noticeDays.wfh),
    },
    sickNoteAfterDays: clampInt(r.sickNoteAfterDays, 0, 60, d.sickNoteAfterDays),
    sickBackdateDays: clampInt(r.sickBackdateDays, 0, 60, d.sickBackdateDays),
    idleMinutes: clampInt(r.idleMinutes, 1, 60, d.idleMinutes),
  };
}

export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ── Days ────────────────────────────────────────────────────────────────

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const weekday = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

export function isWorkDay(ymd: string, policy: HrPolicy, holidays: ReadonlySet<string>): boolean {
  return policy.workDays.includes(weekday(ymd)) && !holidays.has(ymd);
}

export type LeaveRequest = {
  id: string;
  email: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  session: Session;
  /** Working days, worked out when the request is made (half day = 0.5). */
  days: number;
  reason: string;
  status: RequestStatus;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

/** Working days a request covers between `from` and `to` (inclusive); a half day is 0.5. */
export function requestDays(
  r: Pick<LeaveRequest, "type" | "startDate" | "endDate">,
  policy: HrPolicy,
  holidays: ReadonlySet<string>,
  from = r.startDate,
  to = r.endDate,
): number {
  const a = r.startDate > from ? r.startDate : from;
  const b = r.endDate < to ? r.endDate : to;
  if (a > b) return 0;
  const n = eachDay(a, b).filter((d) => isWorkDay(d, policy, holidays)).length;
  return r.type === "half_day" ? Math.min(n, 1) * 0.5 : n;
}

// ── Balances ────────────────────────────────────────────────────────────

/** Leave taken this year before the app (from the old sheet), per person. */
export type Opening = { sick: number; casual: number; annual: number; half_day: number };
export const NO_OPENING: Opening = { sick: 0, casual: 0, annual: 0, half_day: 0 };

export type Balance = { allowed: number; used: number; left: number };
export type Balances = {
  year: number;
  month: string; // YYYY-MM
  sick: Balance;
  casual: Balance;
  annual: Balance;
  /** Counted in half days, not days. */
  half_day: Balance;
  /** This month. */
  wfh: Balance;
};

export const monthEnd = (ymd: string) => `${ymd.slice(0, 7)}-${String(daysInMonth(ymd)).padStart(2, "0")}`;

const bal = (allowed: number, used: number): Balance => ({ allowed, used, left: Math.max(0, allowed - used) });

/**
 * Leave used in `year` (and WFH in `month`) from approved requests plus the opening balance.
 * `month` is any date in the month that matters for WFH.
 */
export function balances(approved: LeaveRequest[], opening: Opening, policy: HrPolicy, holidays: ReadonlySet<string>, month: string): Balances {
  const year = Number(month.slice(0, 4));
  const y0 = `${year}-01-01`;
  const y1 = `${year}-12-31`;
  const m0 = `${month.slice(0, 7)}-01`;
  const m1Last = monthEnd(m0);
  const used = (t: LeaveType, from: string, to: string) =>
    approved.filter((r) => r.status === "approved" && r.type === t).reduce((s, r) => s + requestDays(r, policy, holidays, from, to), 0);
  const halfDays = approved.filter((r) => r.status === "approved" && r.type === "half_day" && r.startDate >= y0 && r.startDate <= y1).length;
  return {
    year,
    month: month.slice(0, 7),
    sick: bal(policy.allowance.sick, opening.sick + used("sick", y0, y1)),
    casual: bal(policy.allowance.casual, opening.casual + used("casual", y0, y1)),
    annual: bal(policy.allowance.annual, opening.annual + used("annual", y0, y1)),
    half_day: bal(policy.allowance.half_day, opening.half_day + halfDays),
    wfh: bal(policy.allowance.wfh_per_month, used("wfh", m0, m1Last)),
  };
}

// ── Policy check (what the HR bot may approve on its own) ─────────────────

export type PolicyCheck = {
  /** True when the request fits every rule; only then may the HR bot approve it. */
  withinPolicy: boolean;
  /** Rules it breaks (why it needs Zain). */
  problems: string[];
  /** Things HR should know that don't block approval. */
  notes: string[];
  days: number;
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Checks a request against the policy. `others` = the same person's other requests
 * (any status; only pending/escalated/approved ones count). `opening` = leave taken before the app.
 */
export function checkPolicy(
  req: Pick<LeaveRequest, "id" | "type" | "startDate" | "endDate" | "session">,
  ctx: { policy: HrPolicy; holidays: ReadonlySet<string>; today: string; others: LeaveRequest[]; opening: Opening },
): PolicyCheck {
  const { policy, holidays, today } = ctx;
  const problems: string[] = [];
  const notes: string[] = [];
  const days = requestDays(req, policy, holidays);
  const others = ctx.others.filter((o) => o.id !== req.id);
  const live = others.filter((o) => o.status === "approved" || o.status === "pending" || o.status === "escalated");

  if (req.type === "other") problems.push("Other / unpaid leave always needs Zain's decision.");
  if (req.endDate < req.startDate) problems.push("The end date is before the start date.");
  if (days === 0) problems.push("No working days in the dates picked (weekend or holiday).");
  if (req.type === "half_day" && (req.startDate !== req.endDate || req.session === "full")) problems.push("A half day is one date, AM or PM.");

  // Notice
  const ahead = daysBetween(today, req.startDate);
  if (req.type === "sick") {
    if (ahead < -policy.sickBackdateDays) problems.push(`Sick leave can be logged up to ${plural(policy.sickBackdateDays, "day")} after; this starts ${-ahead} days ago.`);
  } else if (ahead < 0) {
    problems.push("The dates are in the past.");
  } else if (req.type !== "other") {
    const need = policy.noticeDays[req.type];
    if (ahead < need) problems.push(`${LEAVE_LABELS[req.type]} needs ${plural(need, "day")}' notice; this was asked ${plural(ahead, "day")} ahead.`);
  }

  // Overlap with another live request
  const clash = live.find((o) => o.startDate <= req.endDate && o.endDate >= req.startDate);
  if (clash) {
    const bothHalves = clash.type === "half_day" && req.type === "half_day" && clash.session !== req.session;
    if (!bothHalves) problems.push(`Overlaps another request (${LEAVE_LABELS[clash.type]}, ${clash.startDate}${clash.endDate !== clash.startDate ? ` → ${clash.endDate}` : ""}, ${STATUS_LABELS[clash.status].toLowerCase()}).`);
  }

  // Balance: approved + still-open requests count, so two pending requests can't both use the last day.
  if (req.type !== "other" && days > 0) {
    const years = [...new Set([req.startDate.slice(0, 4), req.endDate.slice(0, 4)])];
    for (const y of years) {
      const b = balances(
        live.map((o) => ({ ...o, status: "approved" as const })),
        y === today.slice(0, 4) ? ctx.opening : NO_OPENING,
        policy,
        holidays,
        `${y}-01-01`,
      );
      if (req.type === "half_day") {
        if (b.half_day.used + 1 > b.half_day.allowed) problems.push(`No half days left in ${y} (${b.half_day.used} of ${b.half_day.allowed} used).`);
      } else if (req.type !== "wfh") {
        const want = requestDays(req, policy, holidays, `${y}-01-01`, `${y}-12-31`);
        const left = b[req.type].left;
        if (want > left) problems.push(`Only ${plural(left, "day")} of ${LEAVE_LABELS[req.type].toLowerCase()} leave left in ${y}; this asks for ${want}.`);
      }
    }
    if (req.type === "wfh") {
      const months = [...new Set(eachDay(req.startDate, req.endDate < req.startDate ? req.startDate : req.endDate).map((d) => d.slice(0, 7)))];
      for (const m of months) {
        const b = balances(live.map((o) => ({ ...o, status: "approved" as const })), NO_OPENING, policy, holidays, `${m}-01`);
        const want = requestDays(req, policy, holidays, `${m}-01`, monthEnd(`${m}-01`));
        if (want > b.wfh.left) problems.push(`Only ${plural(b.wfh.left, "WFH day")} left in ${m}; this asks for ${want}.`);
      }
    }
  }

  if (req.type === "sick" && days > policy.sickNoteAfterDays) notes.push(`Sick leave over ${plural(policy.sickNoteAfterDays, "day")}: HR may ask for a medical note.`);
  return { withinPolicy: problems.length === 0, problems, notes, days };
}

// ── Attendance ──────────────────────────────────────────────────────────

export const DAY_STATUSES = ["office", "wfh", "leave", "holiday", "weekend", "absent", "not_in_yet"] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];
export const DAY_LABELS: Record<DayStatus, string> = {
  office: "Office",
  wfh: "WFH",
  leave: "On leave",
  holiday: "Holiday",
  weekend: "Day off",
  absent: "Absent",
  not_in_yet: "Not in yet",
};

export type CheckIn = { mode: "office" | "wfh"; inAt: string; outAt: string | null };

export type DayInput = {
  day: string;
  today: string;
  /** Current office-local time "HH:MM" (only used for today). */
  nowTime: string;
  policy: HrPolicy;
  holiday: string | null;
  /** Approved leave covering this day, if any. */
  leave: { type: LeaveType; session: Session } | null;
  /** Fingerprint punches that day, "HH:MM" (any order). */
  punches: string[];
  checkIn: CheckIn | null;
  /** An approved WFH request covers the day. */
  wfhApproved: boolean;
};

export type DayResult = {
  status: DayStatus;
  firstIn: string | null;
  lastOut: string | null;
  /** Minutes between first in and last out (office punches or WFH check-in/out). */
  minutes: number | null;
  lateBy: number | null;
  leave: { type: LeaveType; session: Session } | null;
  flags: string[];
};

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function dayStatus(i: DayInput): DayResult {
  const flags: string[] = [];
  const punches = [...new Set(i.punches.map((p) => p.slice(0, 5)))].sort();
  const leave = i.leave && i.leave.type !== "wfh" ? i.leave : null;
  const halfAm = leave?.type === "half_day" && leave.session === "am";
  const fullLeave = !!leave && leave.type !== "half_day";
  const workDay = i.policy.workDays.includes(weekday(i.day)) && !i.holiday;

  let status: DayStatus;
  let firstIn: string | null = null;
  let lastOut: string | null = null;

  if (punches.length) {
    status = "office";
    firstIn = punches[0];
    lastOut = punches.length > 1 ? punches[punches.length - 1] : null;
    if (i.checkIn?.mode === "wfh") flags.push("Checked in as WFH but punched in at the office");
  } else if (i.checkIn) {
    status = i.checkIn.mode;
    firstIn = i.checkIn.inAt;
    lastOut = i.checkIn.outAt;
    if (i.checkIn.mode === "office") flags.push("Checked in as Office in the app, no fingerprint punch");
    if (i.checkIn.mode === "wfh" && !i.wfhApproved) flags.push("WFH not approved (yet)");
  } else if (fullLeave) {
    status = "leave";
  } else if (i.holiday) {
    status = "holiday";
  } else if (!workDay) {
    status = "weekend";
  } else if (i.day > i.today || (i.day === i.today && !leave)) {
    status = "not_in_yet";
  } else if (leave) {
    status = "leave"; // half day and no record of the other half
    if (i.day < i.today) flags.push("Half day off, but no punch or check-in for the other half");
  } else {
    status = "absent";
  }

  if (fullLeave && status !== "leave") flags.push(`Worked on a day of ${LEAVE_LABELS[leave!.type].toLowerCase()} leave`);
  if ((status === "office" || status === "wfh") && !workDay) flags.push(i.holiday ? `Worked on a holiday (${i.holiday})` : "Worked on a day off");

  let lateBy: number | null = null;
  if ((status === "office" || status === "wfh") && firstIn && workDay && !halfAm) {
    const over = toMinutes(firstIn) - toMinutes(i.policy.startTime);
    if (over > i.policy.graceMinutes) lateBy = over;
  }
  if (status === "office" && punches.length === 1 && i.day < i.today) flags.push("Only one punch (no punch out)");
  if (status === "wfh" && !lastOut && i.day < i.today) flags.push("Didn't check out");

  const minutes = firstIn && lastOut ? Math.max(0, toMinutes(lastOut) - toMinutes(firstIn)) : null;
  return { status, firstIn, lastOut, minutes, lateBy, leave: i.leave, flags };
}

// ── Fingerprint machine (ZKTeco attendance log) ─────────────────────────

export type Punch = { deviceUserId: string; date: string; time: string };

const PUNCH_LINE = /^\s*([0-9A-Za-z_-]{1,24})\s*\t\s*(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/;

/**
 * Lines from a ZKTeco attendance log (USB export "attlog.dat", or the machine's push format):
 * `<user id>\t<YYYY-MM-DD HH:MM:SS>\t<status>\t<verify>…`. Bad lines are skipped and counted.
 */
export function parseAttlog(text: string): { punches: Punch[]; skipped: number } {
  const punches: Punch[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = PUNCH_LINE.exec(raw);
    if (!m || !validDateTime(m[2], m[3])) {
      skipped++;
      continue;
    }
    punches.push({ deviceUserId: m[1], date: m[2], time: m[3] });
  }
  return { punches, skipped };
}

export function validDateTime(date: string, time: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return false;
  const [h, m, s = "0"] = time.split(":");
  return Number(h) < 24 && Number(m) < 60 && Number(s) < 60;
}

// ── App time ────────────────────────────────────────────────────────────

/** Seconds each counted heartbeat adds (the browser sends one a minute while someone is active). */
export const BEAT_SECONDS = 60;

/** Brand slug of a dashboard path ("/dashboard/geomod/campaigns" → "geomod"), else null. */
export function brandFromPath(path: string): string | null {
  const m = /^\/dashboard\/([a-z0-9-]+)(?:\/|$)/.exec(path);
  return m ? m[1] : null;
}

export function hours(seconds: number | null | undefined): string {
  if (!seconds) return "0m";
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** Office-local date and "HH:MM" for an instant. */
export function localParts(instant: Date | string, tz: string): { date: string; time: string } {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
