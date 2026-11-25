import "server-only";
import { randomUUID } from "node:crypto";
import { addDays, eachDay } from "@/lib/dates";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_POLICY,
  NO_OPENING,
  isWorkDay,
  localParts,
  normalizePolicy,
  type HrPolicy,
  type LeaveRequest,
  type LeaveType,
  type Opening,
  type RequestStatus,
  type Session,
} from "@/lib/hr/policy";

/**
 * HR data: settings, people, holidays, leave requests, check-ins, fingerprint punches and
 * app time. Always the service role: every caller checks the person's access first.
 * Demo mode uses an in-memory store with sample data.
 */

export type HrPerson = {
  email: string;
  displayName: string | null;
  deviceUserId: string | null;
  tracked: boolean;
  openingYear: number | null;
  opening: Opening;
};
export type Holiday = { day: string; name: string };
export type CheckInRow = { email: string; day: string; mode: "office" | "wfh"; checkedInAt: string; checkedOutAt: string | null };
export type PunchRow = { deviceUserId: string; date: string; time: string };
export type NewPunch = PunchRow;
export type AppTimeRow = { email: string; day: string; brandSlug: string; seconds: number };
export type DeviceUser = { deviceUserId: string; name: string | null; seenAt: string };
export type TeamMember = { email: string; admin: boolean };
export type NewRequest = Pick<LeaveRequest, "email" | "type" | "startDate" | "endDate" | "session" | "days" | "reason"> & { status?: RequestStatus };
export type RequestPatch = Partial<Pick<LeaveRequest, "status" | "decidedBy" | "decidedAt" | "decisionNote">>;
export type RequestFilter = { email?: string; statuses?: RequestStatus[]; from?: string; to?: string; limit?: number };

export interface HrStore {
  getPolicy(): Promise<HrPolicy>;
  savePolicy(p: HrPolicy, by: string): Promise<void>;
  listHolidays(from?: string, to?: string): Promise<Holiday[]>;
  addHoliday(h: Holiday): Promise<void>;
  removeHoliday(day: string): Promise<void>;
  /** Everyone with an app account, and whether they're an admin. */
  team(): Promise<TeamMember[]>;
  listPeople(): Promise<HrPerson[]>;
  savePerson(p: HrPerson): Promise<void>;
  /** Requests overlapping from…to (by date), newest first. */
  listRequests(f: RequestFilter): Promise<LeaveRequest[]>;
  getRequest(id: string): Promise<LeaveRequest | null>;
  createRequest(r: NewRequest): Promise<LeaveRequest>;
  /** Updates only while the request is in one of `fromStatuses`; null if it wasn't (someone else decided first). */
  updateRequest(id: string, patch: RequestPatch, fromStatuses: RequestStatus[]): Promise<LeaveRequest | null>;
  listCheckins(from: string, to: string, email?: string): Promise<CheckInRow[]>;
  /** Creates today's check-in; returns the existing one if already checked in. */
  checkIn(email: string, day: string, mode: "office" | "wfh"): Promise<CheckInRow>;
  checkOut(email: string, day: string): Promise<CheckInRow | null>;
  listPunches(from: string, to: string): Promise<PunchRow[]>;
  /** Stores new punches (duplicates ignored); returns how many were new. */
  addPunches(punches: NewPunch[], source: "bridge" | "upload", device: string | null): Promise<number>;
  listDeviceUsers(): Promise<DeviceUser[]>;
  saveDeviceUsers(users: Array<{ deviceUserId: string; name: string | null }>): Promise<void>;
  /** One active minute; false when another tab already counted this minute. */
  beat(email: string, day: string, brand: string | null): Promise<boolean>;
  appTime(from: string, to: string, email?: string): Promise<AppTimeRow[]>;
}

// ── Supabase ───────────────────────────────────────────────────────────

/** Thrown when the HR tables don't exist yet (migration 0009 hasn't been run). */
export class HrNotReady extends Error {
  constructor() {
    super("HR tables are missing: run supabase/migrations/0009_hr.sql in the Supabase SQL editor.");
  }
}
const MISSING_TABLE = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

const toOpening = (raw: unknown): Opening => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (k: keyof Opening) => (Number.isFinite(Number(r[k])) && Number(r[k]) >= 0 ? Number(r[k]) : 0);
  return { sick: n("sick"), casual: n("casual"), annual: n("annual"), half_day: n("half_day") };
};

type ReqRow = {
  id: string;
  email: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  session: Session;
  days: number | string;
  reason: string;
  status: RequestStatus;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};
const toRequest = (r: ReqRow): LeaveRequest => ({
  id: r.id,
  email: r.email,
  type: r.type,
  startDate: r.start_date,
  endDate: r.end_date,
  session: r.session,
  days: Number(r.days),
  reason: r.reason,
  status: r.status,
  createdAt: r.created_at,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
});
type CheckRow = { email: string; day: string; mode: "office" | "wfh"; checked_in_at: string; checked_out_at: string | null };
const toCheckIn = (r: CheckRow): CheckInRow => ({ email: r.email, day: r.day, mode: r.mode, checkedInAt: r.checked_in_at, checkedOutAt: r.checked_out_at });

const supabaseStore: HrStore = {
  async getPolicy() {
    const { data, error } = await createAdminClient().from("hr_settings").select("policy").eq("id", 1).maybeSingle();
    if (error && MISSING_TABLE.has(error.code)) throw new HrNotReady();
    if (error) throw new Error(error.message);
    return normalizePolicy(data?.policy);
  },
  async savePolicy(p, by) {
    check(await createAdminClient().from("hr_settings").upsert({ id: 1, policy: p, updated_at: new Date().toISOString(), updated_by: by }));
  },
  async listHolidays(from, to) {
    let q = createAdminClient().from("hr_holidays").select("day, name").order("day");
    if (from) q = q.gte("day", from);
    if (to) q = q.lte("day", to);
    return (check(await q) ?? []) as Holiday[];
  },
  async addHoliday(h) {
    check(await createAdminClient().from("hr_holidays").upsert(h));
  },
  async removeHoliday(day) {
    check(await createAdminClient().from("hr_holidays").delete().eq("day", day));
  },
  async team() {
    const db = createAdminClient();
    const [users, admins] = await Promise.all([db.from("app_users").select("user_id, email").order("email"), db.from("user_roles").select("user_id").eq("role", "admin")]);
    const adminIds = new Set(((check(admins) ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
    return ((check(users) ?? []) as Array<{ user_id: string; email: string }>).map((u) => ({ email: u.email.toLowerCase(), admin: adminIds.has(u.user_id) }));
  },
  async listPeople() {
    const rows = (check(await createAdminClient().from("hr_people").select("*")) ?? []) as Array<{
      email: string;
      display_name: string | null;
      device_user_id: string | null;
      tracked: boolean;
      opening_year: number | null;
      opening: unknown;
    }>;
    return rows.map((r) => ({ email: r.email, displayName: r.display_name, deviceUserId: r.device_user_id, tracked: r.tracked, openingYear: r.opening_year, opening: toOpening(r.opening) }));
  },
  async savePerson(p) {
    check(
      await createAdminClient()
        .from("hr_people")
        .upsert({
          email: p.email.toLowerCase(),
          display_name: p.displayName,
          device_user_id: p.deviceUserId,
          tracked: p.tracked,
          opening_year: p.openingYear,
          opening: p.opening,
          updated_at: new Date().toISOString(),
        }),
    );
  },
  async listRequests(f) {
    let q = createAdminClient().from("hr_leave_requests").select("*").order("start_date", { ascending: false }).order("created_at", { ascending: false });
    if (f.email) q = q.eq("email", f.email.toLowerCase());
    if (f.statuses?.length) q = q.in("status", f.statuses);
    if (f.from) q = q.gte("end_date", f.from);
    if (f.to) q = q.lte("start_date", f.to);
    q = q.limit(f.limit ?? 500);
    return ((check(await q) ?? []) as ReqRow[]).map(toRequest);
  },
  async getRequest(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { data, error } = await createAdminClient().from("hr_leave_requests").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toRequest(data as ReqRow) : null;
  },
  async createRequest(r) {
    const row = check(
      await createAdminClient()
        .from("hr_leave_requests")
        .insert({ email: r.email.toLowerCase(), type: r.type, start_date: r.startDate, end_date: r.endDate, session: r.session, days: r.days, reason: r.reason, status: r.status ?? "pending" })
        .select("*")
        .single(),
    );
    return toRequest(row as ReqRow);
  },
  async updateRequest(id, patch, fromStatuses) {
    const row: Record<string, unknown> = {};
    if (patch.status) row.status = patch.status;
    if (patch.decidedBy !== undefined) row.decided_by = patch.decidedBy;
    if (patch.decidedAt !== undefined) row.decided_at = patch.decidedAt;
    if (patch.decisionNote !== undefined) row.decision_note = patch.decisionNote;
    const data = check(await createAdminClient().from("hr_leave_requests").update(row).eq("id", id).in("status", fromStatuses).select("*"));
    const rows = (data ?? []) as ReqRow[];
    return rows.length ? toRequest(rows[0]) : null;
  },
  async listCheckins(from, to, email) {
    let q = createAdminClient().from("hr_checkins").select("*").gte("day", from).lte("day", to);
    if (email) q = q.eq("email", email.toLowerCase());
    return ((check(await q) ?? []) as CheckRow[]).map(toCheckIn);
  },
  async checkIn(email, day, mode) {
    const db = createAdminClient();
    const e = email.toLowerCase();
    check(await db.from("hr_checkins").upsert({ email: e, day, mode }, { onConflict: "email,day", ignoreDuplicates: true }));
    const row = check(await db.from("hr_checkins").select("*").eq("email", e).eq("day", day).single());
    return toCheckIn(row as CheckRow);
  },
  async checkOut(email, day) {
    const data = check(
      await createAdminClient().from("hr_checkins").update({ checked_out_at: new Date().toISOString() }).eq("email", email.toLowerCase()).eq("day", day).select("*"),
    );
    const rows = (data ?? []) as CheckRow[];
    return rows.length ? toCheckIn(rows[0]) : null;
  },
  async listPunches(from, to) {
    const rows = (check(
      await createAdminClient().from("hr_punches").select("device_user_id, punch_date, punch_time").gte("punch_date", from).lte("punch_date", to).order("punch_time").limit(20000),
    ) ?? []) as Array<{ device_user_id: string; punch_date: string; punch_time: string }>;
    return rows.map((r) => ({ deviceUserId: r.device_user_id, date: r.punch_date, time: r.punch_time }));
  },
  async addPunches(punches, source, device) {
    let added = 0;
    const db = createAdminClient();
    for (let i = 0; i < punches.length; i += 500) {
      const chunk = punches.slice(i, i + 500).map((p) => ({ device_user_id: p.deviceUserId, punch_date: p.date, punch_time: p.time, source, device }));
      const data = check(await db.from("hr_punches").upsert(chunk, { onConflict: "device_user_id,punch_date,punch_time", ignoreDuplicates: true }).select("id"));
      added += (data ?? []).length;
    }
    return added;
  },
  async listDeviceUsers() {
    const rows = (check(await createAdminClient().from("hr_device_users").select("*").order("device_user_id")) ?? []) as Array<{ device_user_id: string; name: string | null; seen_at: string }>;
    return rows.map((r) => ({ deviceUserId: r.device_user_id, name: r.name, seenAt: r.seen_at }));
  },
  async saveDeviceUsers(users) {
    if (!users.length) return;
    const now = new Date().toISOString();
    check(await createAdminClient().from("hr_device_users").upsert(users.map((u) => ({ device_user_id: u.deviceUserId, name: u.name, seen_at: now }))));
  },
  async beat(email, day, brand) {
    const { data, error } = await createAdminClient().rpc("hr_beat", { p_email: email, p_day: day, p_brand: brand ?? "", p_seconds: 60 });
    if (error) throw new Error(error.message);
    return data === true;
  },
  async appTime(from, to, email) {
    let q = createAdminClient().from("hr_app_time").select("email, day, brand_slug, seconds").gte("day", from).lte("day", to).limit(20000);
    if (email) q = q.eq("email", email.toLowerCase());
    const rows = (check(await q) ?? []) as Array<{ email: string; day: string; brand_slug: string; seconds: number }>;
    return rows.map((r) => ({ email: r.email, day: r.day, brandSlug: r.brand_slug, seconds: r.seconds }));
  },
};

// ── Demo (in memory) ───────────────────────────────────────────────────

type Mem = {
  policy: HrPolicy;
  holidays: Holiday[];
  people: HrPerson[];
  requests: LeaveRequest[];
  checkins: CheckInRow[];
  punches: PunchRow[];
  deviceUsers: DeviceUser[];
  appTime: AppTimeRow[];
  lastBeat: Map<string, number>;
};
const g = globalThis as unknown as { __amzHr?: Mem };

const DEMO_TEAM: TeamMember[] = [
  { email: "demo@amzcentric.com", admin: true },
  { email: "sara@amzcentric.com", admin: false },
  { email: "ali@amzcentric.com", admin: false },
  { email: "nina@amzcentric.com", admin: false },
  { email: "omar@amzcentric.com", admin: false },
  { email: "new@amzcentric.com", admin: false },
];

/** Deterministic 0…1 from a string, so demo data is the same on every reload. */
function rand(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

function seed(): Mem {
  const policy = DEFAULT_POLICY;
  const { date: today, time: now } = localParts(new Date(), policy.timezone);
  const nowMins = Number(now.slice(0, 2)) * 60 + Number(now.slice(3));
  const holidays: Holiday[] = [
    { day: "2026-11-09", name: "Iqbal Day" },
    { day: "2026-12-25", name: "Quaid-e-Azam Day" },
    { day: "2027-02-05", name: "Kashmir Solidarity Day" },
  ];
  const hset = new Set(holidays.map((h) => h.day));
  const people: HrPerson[] = [
    { email: "sara@amzcentric.com", displayName: "Sara", deviceUserId: "101", tracked: true, openingYear: Number(today.slice(0, 4)), opening: { ...NO_OPENING, annual: 4, sick: 1 } },
    { email: "ali@amzcentric.com", displayName: "Ali", deviceUserId: "102", tracked: true, openingYear: Number(today.slice(0, 4)), opening: { ...NO_OPENING, casual: 2 } },
    { email: "nina@amzcentric.com", displayName: "Nina", deviceUserId: "103", tracked: true, openingYear: Number(today.slice(0, 4)), opening: NO_OPENING },
    { email: "omar@amzcentric.com", displayName: "Omar", deviceUserId: "104", tracked: true, openingYear: Number(today.slice(0, 4)), opening: { ...NO_OPENING, half_day: 1 } },
    { email: "new@amzcentric.com", displayName: null, deviceUserId: null, tracked: true, openingYear: null, opening: NO_OPENING },
    { email: "demo@amzcentric.com", displayName: "Zain", deviceUserId: null, tracked: false, openingYear: null, opening: NO_OPENING },
  ];
  const created = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const req = (email: string, type: LeaveType, start: string, end: string, status: RequestStatus, reason: string, session: Session = "full", decidedBy: string | null = null): LeaveRequest => ({
    id: randomUUID(),
    email,
    type,
    startDate: start,
    endDate: end,
    session,
    days: type === "half_day" ? 0.5 : eachDay(start, end).filter((d) => isWorkDay(d, policy, hset)).length,
    reason,
    status,
    createdAt: created,
    decidedBy: status === "approved" || status === "declined" ? (decidedBy ?? "hr-bot") : null,
    decidedAt: status === "approved" || status === "declined" ? created : null,
    decisionNote: null,
  });
  const workdays = (from: number, to: number) => eachDay(addDays(today, from), addDays(today, to)).filter((d) => isWorkDay(d, policy, hset));
  const lastWeek = workdays(-9, -5);
  const nextWeek = workdays(5, 12);
  const yesterday = workdays(-4, -1).at(-1)!;
  const soon = workdays(1, 7); // starts tomorrow-ish: short of the 3 days' notice annual leave needs
  const requests: LeaveRequest[] = [
    req("ali@amzcentric.com", "annual", lastWeek[0], lastWeek[2], "approved", "Brother's wedding"),
    req("nina@amzcentric.com", "sick", yesterday, yesterday, "approved", "Fever"),
    req("omar@amzcentric.com", "wfh", today, today, "approved", "Waiting for a delivery at home"),
    req("omar@amzcentric.com", "casual", nextWeek[0], nextWeek[0], "pending", "University exam"),
    req("sara@amzcentric.com", "annual", soon[0], soon[2], "escalated", "Family trip"),
    req("ali@amzcentric.com", "wfh", nextWeek[2], nextWeek[2], "pending", "Plumber visit"),
  ];
  Object.assign(requests[4], { decidedBy: "hr-bot", decidedAt: created, decisionNote: "Annual leave needs 3 days' notice; this was asked 1 day ahead. Your call." });

  // Fingerprint punches for the last 5 weeks, minus leave days; nobody punches on WFH days.
  const punches: PunchRow[] = [];
  const appTime: AppTimeRow[] = [];
  const off = (email: string, d: string) => requests.some((r) => r.email === email && r.status === "approved" && r.startDate <= d && r.endDate >= d);
  const brands = ["harbor-pine", "lumen-labs", "kodiak-trail", "bloomwell", ""];
  for (const p of people.filter((x) => x.deviceUserId)) {
    for (const d of workdays(-35, 0)) {
      if (off(p.email, d)) continue;
      const r = rand(p.email + d);
      if (r < 0.04 && d !== today) continue; // the odd absence
      const inAt = 8 * 60 + 40 + Math.floor(r * 50); // 08:40–09:30
      const outAt = 17 * 60 + 45 + Math.floor(rand(d + p.email) * 75);
      if (d === today && nowMins < inAt) continue;
      punches.push({ deviceUserId: p.deviceUserId!, date: d, time: `${hhmm(inAt)}:00` });
      if (d !== today || nowMins > outAt) punches.push({ deviceUserId: p.deviceUserId!, date: d, time: `${hhmm(outAt)}:00` });
      const total = d === today ? Math.max(0, Math.min(nowMins, outAt) - inAt) * 60 * 0.8 : (outAt - inAt) * 60 * (0.55 + rand(p.email + d + "t") * 0.35);
      const split = [0.4, 0.25, 0.15, 0.1, 0.1];
      split.forEach((s, i) => appTime.push({ email: p.email, day: d, brandSlug: brands[i], seconds: Math.round((total * s) / 60) * 60 }));
    }
  }
  const omarIn = Math.min(nowMins, 9 * 60 + 7);
  const checkins: CheckInRow[] = [{ email: "omar@amzcentric.com", day: today, mode: "wfh", checkedInAt: new Date(Date.now() - (nowMins - omarIn) * 60_000).toISOString(), checkedOutAt: null }];
  return {
    policy,
    holidays,
    people,
    requests,
    checkins,
    punches,
    deviceUsers: people.filter((p) => p.deviceUserId).map((p) => ({ deviceUserId: p.deviceUserId!, name: p.displayName, seenAt: created })),
    appTime,
    lastBeat: new Map(),
  };
}

const mem = () => (g.__amzHr ??= seed());

const demoStore: HrStore = {
  async getPolicy() {
    return mem().policy;
  },
  async savePolicy(p) {
    mem().policy = p;
  },
  async listHolidays(from, to) {
    return mem().holidays.filter((h) => (!from || h.day >= from) && (!to || h.day <= to)).sort((a, b) => a.day.localeCompare(b.day));
  },
  async addHoliday(h) {
    const m = mem();
    m.holidays = [...m.holidays.filter((x) => x.day !== h.day), h];
  },
  async removeHoliday(day) {
    const m = mem();
    m.holidays = m.holidays.filter((x) => x.day !== day);
  },
  async team() {
    return DEMO_TEAM;
  },
  async listPeople() {
    return mem().people;
  },
  async savePerson(p) {
    const m = mem();
    m.people = [...m.people.filter((x) => x.email !== p.email), p];
  },
  async listRequests(f) {
    return mem()
      .requests.filter((r) => (!f.email || r.email === f.email.toLowerCase()) && (!f.statuses?.length || f.statuses.includes(r.status)) && (!f.from || r.endDate >= f.from) && (!f.to || r.startDate <= f.to))
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, f.limit ?? 500);
  },
  async getRequest(id) {
    return mem().requests.find((r) => r.id === id) ?? null;
  },
  async createRequest(r) {
    const row: LeaveRequest = { ...r, email: r.email.toLowerCase(), id: randomUUID(), status: r.status ?? "pending", createdAt: new Date().toISOString(), decidedBy: null, decidedAt: null, decisionNote: null };
    mem().requests.push(row);
    return row;
  },
  async updateRequest(id, patch, fromStatuses) {
    const r = mem().requests.find((x) => x.id === id);
    if (!r || !fromStatuses.includes(r.status)) return null;
    Object.assign(r, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return r;
  },
  async listCheckins(from, to, email) {
    return mem().checkins.filter((c) => c.day >= from && c.day <= to && (!email || c.email === email.toLowerCase()));
  },
  async checkIn(email, day, mode) {
    const m = mem();
    const e = email.toLowerCase();
    const existing = m.checkins.find((c) => c.email === e && c.day === day);
    if (existing) return existing;
    const row: CheckInRow = { email: e, day, mode, checkedInAt: new Date().toISOString(), checkedOutAt: null };
    m.checkins.push(row);
    return row;
  },
  async checkOut(email, day) {
    const c = mem().checkins.find((x) => x.email === email.toLowerCase() && x.day === day);
    if (!c) return null;
    c.checkedOutAt = new Date().toISOString();
    return c;
  },
  async listPunches(from, to) {
    return mem().punches.filter((p) => p.date >= from && p.date <= to);
  },
  async addPunches(punches) {
    const m = mem();
    const have = new Set(m.punches.map((p) => `${p.deviceUserId}|${p.date}|${p.time}`));
    let added = 0;
    for (const p of punches) {
      const k = `${p.deviceUserId}|${p.date}|${p.time}`;
      if (have.has(k)) continue;
      have.add(k);
      m.punches.push(p);
      added++;
    }
    return added;
  },
  async listDeviceUsers() {
    return mem().deviceUsers;
  },
  async saveDeviceUsers(users) {
    const m = mem();
    const now = new Date().toISOString();
    for (const u of users) {
      m.deviceUsers = [...m.deviceUsers.filter((x) => x.deviceUserId !== u.deviceUserId), { ...u, seenAt: now }];
    }
  },
  async beat(email, day, brand) {
    const m = mem();
    const e = email.toLowerCase();
    const last = m.lastBeat.get(e) ?? 0;
    if (Date.now() - last < 50_000) return false;
    m.lastBeat.set(e, Date.now());
    const row = m.appTime.find((r) => r.email === e && r.day === day && r.brandSlug === (brand ?? ""));
    if (row) row.seconds += 60;
    else m.appTime.push({ email: e, day, brandSlug: brand ?? "", seconds: 60 });
    return true;
  },
  async appTime(from, to, email) {
    return mem().appTime.filter((r) => r.day >= from && r.day <= to && (!email || r.email === email.toLowerCase()));
  },
};

export function hrStore(): HrStore {
  return isDemoMode() ? demoStore : supabaseStore;
}
