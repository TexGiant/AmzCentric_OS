import "server-only";
import { randomUUID } from "node:crypto";
import { addDays, todayUtc } from "@/lib/dates";
import { isDemoMode } from "@/lib/env";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_USERS } from "@/lib/demo-users";
import { canSeeBrand } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Weekly brand meetings and their tasks. Supabase in production (service role — callers
 * check the user first), an in-memory store in demo mode so the flow can be tried end to end.
 */

export const INSIGHT_TYPES = ["win", "risk", "opportunity", "decision", "client_request"] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];
export type Insight = { type: InsightType; title: string; detail: string };

export type MeetingSource = "paste" | "claude" | "webhook";
export type MeetingStatus = "pending" | "processing" | "done" | "failed" | "skipped";

export type Meeting = {
  id: string;
  brandSlug: string;
  title: string;
  meetingDate: string;
  notes: string;
  source: MeetingSource;
  externalId: string | null;
  status: MeetingStatus;
  summary: string | null;
  insights: Insight[];
  agenda: string[];
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  analyzedAt: string | null;
};

export const TASK_STATUSES = ["open", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskSource = "ai" | "manual" | "claude";

export type Task = {
  id: string;
  brandSlug: string;
  meetingId: string | null;
  title: string;
  detail: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  dueDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  source: TaskSource;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
  completedNote: string | null;
};

export type NewMeeting = Pick<Meeting, "brandSlug" | "title" | "meetingDate" | "notes" | "source"> &
  Partial<Pick<Meeting, "externalId" | "createdBy" | "status" | "summary" | "insights" | "agenda" | "analyzedAt">>;
export type NewTask = Pick<Task, "brandSlug" | "title"> &
  Partial<Pick<Task, "meetingId" | "detail" | "ownerEmail" | "ownerName" | "dueDate" | "priority" | "status" | "source" | "createdBy">>;
export type TaskPatch = Partial<Pick<Task, "title" | "detail" | "ownerEmail" | "ownerName" | "dueDate" | "priority" | "status" | "completedNote">>;
export type TaskFilter = { brand?: string; status?: TaskStatus[]; owner?: string; meetingId?: string; limit?: number };

export interface MeetingStore {
  listMeetings(brand: string, limit?: number): Promise<Meeting[]>;
  getMeeting(id: string): Promise<Meeting | null>;
  /** Returns the existing meeting (duplicate: true) when external_id was already saved for the brand. */
  createMeeting(m: NewMeeting): Promise<{ meeting: Meeting; duplicate: boolean }>;
  updateMeeting(id: string, patch: Partial<Omit<Meeting, "id" | "brandSlug" | "createdAt">>): Promise<void>;
  deleteMeeting(id: string): Promise<void>;
  listTasks(f: TaskFilter): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  createTasks(tasks: NewTask[]): Promise<Task[]>;
  updateTask(id: string, patch: TaskPatch): Promise<Task | null>;
  deleteTask(id: string): Promise<void>;
  /** Emails of everyone who can see this brand (admins + people assigned to it). */
  brandMembers(brand: string): Promise<string[]>;
}

// ── Supabase ───────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
const toMeeting = (r: any): Meeting => ({
  id: r.id,
  brandSlug: r.brand_slug,
  title: r.title,
  meetingDate: r.meeting_date,
  notes: r.notes,
  source: r.source,
  externalId: r.external_id,
  status: r.status,
  summary: r.summary,
  insights: Array.isArray(r.insights) ? r.insights : [],
  agenda: Array.isArray(r.agenda) ? r.agenda : [],
  error: r.error,
  createdBy: r.created_by,
  createdAt: r.created_at,
  analyzedAt: r.analyzed_at,
});

const toTask = (r: any): Task => ({
  id: r.id,
  brandSlug: r.brand_slug,
  meetingId: r.meeting_id,
  title: r.title,
  detail: r.detail,
  ownerEmail: r.owner_email,
  ownerName: r.owner_name,
  dueDate: r.due_date,
  priority: r.priority,
  status: r.status,
  source: r.source,
  createdBy: r.created_by,
  createdAt: r.created_at,
  completedAt: r.completed_at,
  completedNote: r.completed_note,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const meetingCols = (m: Partial<Meeting>) => {
  const row: Record<string, unknown> = {};
  const map: Record<string, string> = {
    brandSlug: "brand_slug",
    title: "title",
    meetingDate: "meeting_date",
    notes: "notes",
    source: "source",
    externalId: "external_id",
    status: "status",
    summary: "summary",
    insights: "insights",
    agenda: "agenda",
    error: "error",
    createdBy: "created_by",
    analyzedAt: "analyzed_at",
  };
  for (const [k, v] of Object.entries(m)) if (v !== undefined && map[k]) row[map[k]] = v;
  return row;
};

const taskCols = (t: Partial<Task>) => {
  const row: Record<string, unknown> = {};
  const map: Record<string, string> = {
    brandSlug: "brand_slug",
    meetingId: "meeting_id",
    title: "title",
    detail: "detail",
    ownerEmail: "owner_email",
    ownerName: "owner_name",
    dueDate: "due_date",
    priority: "priority",
    status: "status",
    source: "source",
    createdBy: "created_by",
    completedNote: "completed_note",
  };
  for (const [k, v] of Object.entries(t)) if (v !== undefined && map[k]) row[map[k]] = v;
  return row;
};

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

const STATUS_ORDER: Record<TaskStatus, number> = { in_progress: 0, open: 1, done: 2 };
const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.status === "done" ? (b.completedAt ?? "").localeCompare(a.completedAt ?? "") : 0) ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      b.createdAt.localeCompare(a.createdAt),
  );
}

/**
 * Reads go through `readDb`: the signed-in person's client for pages (RLS applies), or the
 * service role for server jobs and the connector (which check access in code). Writes always
 * use the service role, after the caller has checked permissions.
 */
function makeSupabaseStore(readDb: () => Promise<SupabaseClient> | SupabaseClient): MeetingStore {
  return {
  async listMeetings(brand, limit = 50) {
    const db = await readDb();
    const rows = check(
      await db.from("meetings").select("*").eq("brand_slug", brand).order("meeting_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit),
    );
    return (rows ?? []).map(toMeeting);
  },
  async getMeeting(id) {
    const rows = check(await (await readDb()).from("meetings").select("*").eq("id", id).limit(1));
    return rows?.[0] ? toMeeting(rows[0]) : null;
  },
  async createMeeting(m) {
    const db = createAdminClient();
    if (m.externalId) {
      const existing = check(await db.from("meetings").select("*").eq("brand_slug", m.brandSlug).eq("external_id", m.externalId).limit(1));
      if (existing?.[0]) return { meeting: toMeeting(existing[0]), duplicate: true };
    }
    const row = check(await db.from("meetings").insert(meetingCols(m)).select("*").single());
    return { meeting: toMeeting(row), duplicate: false };
  },
  async updateMeeting(id, patch) {
    check(await createAdminClient().from("meetings").update(meetingCols(patch)).eq("id", id));
  },
  async deleteMeeting(id) {
    const db = createAdminClient();
    // Tasks keep living after their meeting is deleted unless they were never touched.
    check(await db.from("tasks").delete().eq("meeting_id", id).eq("status", "open").in("source", ["ai", "claude"]));
    check(await db.from("meetings").delete().eq("id", id));
  },
  async listTasks(f) {
    let q = (await readDb()).from("tasks").select("*");
    if (f.brand) q = q.eq("brand_slug", f.brand);
    if (f.status?.length) q = q.in("status", f.status);
    if (f.owner) q = q.ilike("owner_email", f.owner);
    if (f.meetingId) q = q.eq("meeting_id", f.meetingId);
    const rows = check(await q.order("created_at", { ascending: false }).limit(f.limit ?? 500));
    return sortTasks((rows ?? []).map(toTask));
  },
  async getTask(id) {
    const rows = check(await (await readDb()).from("tasks").select("*").eq("id", id).limit(1));
    return rows?.[0] ? toTask(rows[0]) : null;
  },
  async createTasks(tasks) {
    if (!tasks.length) return [];
    const rows = check(await createAdminClient().from("tasks").insert(tasks.map(taskCols)).select("*"));
    return (rows ?? []).map(toTask);
  },
  async updateTask(id, patch) {
    const row: Record<string, unknown> = { ...taskCols(patch), updated_at: new Date().toISOString() };
    if (patch.status) row.completed_at = patch.status === "done" ? new Date().toISOString() : null;
    if (patch.status && patch.status !== "done") row.completed_note = null;
    const rows = check(await createAdminClient().from("tasks").update(row).eq("id", id).select("*"));
    return rows?.[0] ? toTask(rows[0]) : null;
  },
  async deleteTask(id) {
    check(await createAdminClient().from("tasks").delete().eq("id", id));
  },
  async brandMembers(brand) {
    const db = createAdminClient();
    const [roles, assigned, users] = await Promise.all([
      db.from("user_roles").select("user_id, role"),
      db.from("user_brands").select("user_id").eq("brand_slug", brand),
      db.from("app_users").select("user_id, email"),
    ]);
    const byUser = new Map<string, string[]>();
    for (const r of (roles.data ?? []) as Array<{ user_id: string; role: string }>) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role]);
    const onBrand = new Set(((assigned.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
    return ((users.data ?? []) as Array<{ user_id: string; email: string }>)
      .filter((u) => {
        const rs = byUser.get(u.user_id) ?? [];
        return rs.includes("admin") || (onBrand.has(u.user_id) && rs.some((r) => r !== "admin"));
      })
      .map((u) => u.email.toLowerCase())
      .sort();
  },
  };
}

// ── Demo (in memory) ───────────────────────────────────────────────────

type Mem = { meetings: Meeting[]; tasks: Task[] };
const g = globalThis as unknown as { __amzMeetings?: Mem };

function seed(): Mem {
  const today = todayUtc();
  const lastWeek = addDays(today, -6);
  const now = new Date().toISOString();
  const meetingId = randomUUID();
  const meeting: Meeting = {
    id: meetingId,
    brandSlug: "harbor-pine",
    title: "Harbor & Pine × AmzCentric — weekly",
    meetingDate: lastWeek,
    notes:
      "Attendees: Sarah (Harbor & Pine), Ali, Jehan (AmzCentric)\n\n" +
      "- Sarah: Q4 inventory for the 12oz candle lands Dec 2; wants to push Black Friday harder.\n" +
      "- Ali: ACOS went from 24% to 31% this week, mostly from the broad auto campaign. Proposes cutting bids 15% on broad and moving budget to exact.\n" +
      "- Sarah approved a 20% coupon for Black Friday week.\n" +
      "- Jehan to build an SB video campaign for the gift set by Friday.\n" +
      "- Open question: should we launch in Canada before January? Sarah to check with ops.\n",
    source: "paste",
    externalId: null,
    status: "done",
    summary:
      "ACOS rose from 24% to 31% this week, driven by the broad auto campaign. The team agreed to shift budget from broad to exact, run a 20% Black Friday coupon, and launch an SB video for the gift set. Inventory for the 12oz candle arrives Dec 2.",
    insights: [
      { type: "risk", title: "ACOS up 7 points week over week", detail: "Most of the increase came from the broad auto campaign; exact match held steady." },
      { type: "decision", title: "20% coupon approved for Black Friday week", detail: "Sarah approved it on the call; the coupon needs to be live before the Friday traffic spike." },
      { type: "opportunity", title: "Gift set has no video ad yet", detail: "An SB video for the gift set is the main Q4 creative gap." },
      { type: "client_request", title: "Push Black Friday harder", detail: "Client wants more aggressive spend during Black Friday / Cyber Monday." },
    ],
    agenda: ["Did the broad → exact budget shift bring ACOS back under 25%?", "Canada launch decision from Sarah's ops team", "Black Friday coupon results"],
    error: null,
    createdBy: "demo@amzcentric.com",
    createdAt: now,
    analyzedAt: now,
  };
  const t = (title: string, extra: Partial<Task>): Task => ({
    id: randomUUID(),
    brandSlug: "harbor-pine",
    meetingId,
    title,
    detail: null,
    ownerEmail: null,
    ownerName: null,
    dueDate: null,
    priority: "medium",
    status: "open",
    source: "ai",
    createdBy: "demo@amzcentric.com",
    createdAt: now,
    completedAt: null,
    completedNote: null,
    ...extra,
  });
  return {
    meetings: [meeting],
    tasks: [
      t("Cut broad auto bids 15% and move the budget to exact", { ownerEmail: "ali@amzcentric.com", dueDate: addDays(lastWeek, 1), priority: "high", status: "done", completedAt: now }),
      t("Set up 20% Black Friday coupon", { ownerEmail: "nina@amzcentric.com", dueDate: addDays(today, 2), priority: "high", status: "in_progress" }),
      t("Build SB video campaign for the gift set", { ownerEmail: "ali@amzcentric.com", dueDate: addDays(today, 1), detail: "Use the 15s gift-set video; target gift + candle set keywords." }),
      t("Confirm Canada launch timing with ops", { ownerName: "Sarah (Harbor & Pine)", priority: "low" }),
    ],
  };
}

function mem(): Mem {
  return (g.__amzMeetings ??= seed());
}

const demoStore: MeetingStore = {
  async listMeetings(brand, limit = 50) {
    return mem()
      .meetings.filter((m) => m.brandSlug === brand)
      .sort((a, b) => b.meetingDate.localeCompare(a.meetingDate) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  },
  async getMeeting(id) {
    return mem().meetings.find((m) => m.id === id) ?? null;
  },
  async createMeeting(m) {
    const existing = m.externalId && mem().meetings.find((x) => x.brandSlug === m.brandSlug && x.externalId === m.externalId);
    if (existing) return { meeting: existing, duplicate: true };
    const meeting: Meeting = {
      id: randomUUID(),
      externalId: null,
      status: "pending",
      summary: null,
      insights: [],
      agenda: [],
      error: null,
      createdBy: null,
      createdAt: new Date().toISOString(),
      analyzedAt: null,
      ...m,
    };
    mem().meetings.push(meeting);
    return { meeting, duplicate: false };
  },
  async updateMeeting(id, patch) {
    const m = mem().meetings.find((x) => x.id === id);
    if (m) Object.assign(m, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
  },
  async deleteMeeting(id) {
    const s = mem();
    s.tasks = s.tasks.filter((t) => !(t.meetingId === id && t.status === "open" && t.source !== "manual"));
    s.tasks.forEach((t) => t.meetingId === id && (t.meetingId = null));
    s.meetings = s.meetings.filter((m) => m.id !== id);
  },
  async listTasks(f) {
    return sortTasks(
      mem().tasks.filter(
        (t) =>
          (!f.brand || t.brandSlug === f.brand) &&
          (!f.status?.length || f.status.includes(t.status)) &&
          (!f.owner || t.ownerEmail?.toLowerCase() === f.owner.toLowerCase()) &&
          (!f.meetingId || t.meetingId === f.meetingId),
      ),
    ).slice(0, f.limit ?? 500);
  },
  async getTask(id) {
    return mem().tasks.find((t) => t.id === id) ?? null;
  },
  async createTasks(tasks) {
    const now = new Date().toISOString();
    const created = tasks.map(
      (t): Task => ({
        id: randomUUID(),
        meetingId: null,
        detail: null,
        ownerEmail: null,
        ownerName: null,
        dueDate: null,
        priority: "medium",
        status: "open",
        source: "manual",
        createdBy: null,
        createdAt: now,
        completedAt: null,
        completedNote: null,
        ...Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined)),
      }) as Task,
    );
    mem().tasks.push(...created);
    return created;
  },
  async updateTask(id, patch) {
    const t = mem().tasks.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    if (patch.status) {
      t.completedAt = patch.status === "done" ? new Date().toISOString() : null;
      if (patch.status !== "done") t.completedNote = null;
    }
    return t;
  },
  async deleteTask(id) {
    mem().tasks = mem().tasks.filter((t) => t.id !== id);
  },
  async brandMembers(brand) {
    return DEMO_USERS.filter((u) => canSeeBrand(u, brand)).map((u) => u.email);
  },
};

const serviceStore = makeSupabaseStore(createAdminClient);
const userStore = makeSupabaseStore(createClient);

/**
 * `asUser: true` for pages and server actions (reads respect the person's RLS policies);
 * default for server jobs, the webhook and the connector, which check access in code.
 */
export function meetingStore(opts: { asUser?: boolean } = {}): MeetingStore {
  if (isDemoMode()) return demoStore;
  return opts.asUser ? userStore : serviceStore;
}
