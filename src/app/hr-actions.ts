"use server";

import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { LEAVE_LABELS, normalizePolicy, parseAttlog, validTimezone, type Opening } from "@/lib/hr/policy";
import { checkIn, createLeave, decide, findPerson, hrContext, type Decision } from "@/lib/hr/service";
import { can, type Access } from "@/lib/rbac";

export type FormState = { ok?: boolean; error?: string; message?: string };

const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const NO = { error: "You don't have access to do that." };
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function refresh() {
  revalidatePath("/me");
  revalidatePath("/hr");
  revalidatePath("/settings/hr");
  revalidatePath("/", "layout"); // the check-in banner
}

async function me(): Promise<{ a: Access; ok: boolean }> {
  const a = await requireAccess();
  return { a, ok: can(a, "hr.self") };
}

// ── Everyone: check in / out, leave requests ─────────────────────────────

export async function checkInAction(form: FormData): Promise<void> {
  const { a, ok } = await me();
  if (!ok) return;
  const mode = str(form, "mode") === "wfh" ? "wfh" : "office";
  const ctx = await hrContext();
  const p = await findPerson(ctx, a.email);
  if (!p) return;
  const { checkIn: row, filed } = await checkIn(ctx, p, mode);
  await audit({ action: "hr.check_in", actor: a, target: row.day, detail: { mode: row.mode, filed_wfh_request: filed?.id ?? null } });
  refresh();
}

export async function checkOutAction(): Promise<void> {
  const { a, ok } = await me();
  if (!ok) return;
  const ctx = await hrContext();
  const row = await ctx.store.checkOut(a.email, ctx.today);
  if (row) await audit({ action: "hr.check_out", actor: a, target: row.day });
  refresh();
}

export async function requestLeaveAction(_: FormState, form: FormData): Promise<FormState> {
  const { a, ok } = await me();
  if (!ok) return NO;
  const ctx = await hrContext();
  const p = await findPerson(ctx, a.email);
  if (!p) return NO;
  const res = await createLeave(ctx, p, {
    type: str(form, "type"),
    startDate: str(form, "start_date"),
    endDate: str(form, "end_date"),
    session: str(form, "session"),
    reason: str(form, "reason"),
  });
  if ("error" in res) return { error: res.error };
  const r = res.request;
  await audit({ action: "hr.leave_request", actor: a, target: r.id, detail: { type: r.type, start: r.startDate, end: r.endDate, days: r.days, within_policy: res.check.withinPolicy } });
  refresh();
  const label = LEAVE_LABELS[r.type].toLowerCase();
  return {
    ok: true,
    message: res.check.withinPolicy
      ? `Sent: ${r.days} day${r.days === 1 ? "" : "s"} of ${label}. HR will confirm.`
      : `Sent: ${label}. It's outside the policy (${res.check.problems[0]}), so it goes to Zain to decide.`,
  };
}

export async function cancelRequestAction(form: FormData): Promise<void> {
  const { a, ok } = await me();
  if (!ok) return;
  const ctx = await hrContext();
  const id = str(form, "id");
  const res = await decide(ctx, id, "cancel", { kind: "self", email: a.email }, null);
  if (res.ok) await audit({ action: "hr.leave_cancel", actor: a, target: id });
  refresh();
}

// ── Admins: decisions, settings, people, holidays, punch upload ─────────

async function manager(): Promise<Access | null> {
  const a = await requireAccess();
  return can(a, "hr.manage") ? a : null;
}

export async function decideAction(_: FormState, form: FormData): Promise<FormState> {
  const a = await manager();
  if (!a) return NO;
  const id = str(form, "id");
  const action = str(form, "action") as Decision;
  if (!["approve", "decline", "cancel"].includes(action)) return { error: "Unknown action." };
  const ctx = await hrContext();
  const res = await decide(ctx, id, action, { kind: "admin", email: a.email }, str(form, "note") || null);
  if (!res.ok) return { error: res.error };
  await audit({ action: `hr.leave_${action}`, actor: a, target: id, detail: { email: res.request.email, type: res.request.type, start: res.request.startDate, end: res.request.endDate } });
  refresh();
  return { ok: true, message: `${action === "approve" ? "Approved" : action === "decline" ? "Declined" : "Cancelled"}.` };
}

const num = (form: FormData, k: string) => Number(str(form, k));

export async function savePolicyAction(_: FormState, form: FormData): Promise<FormState> {
  const a = await manager();
  if (!a) return NO;
  const tz = str(form, "timezone");
  if (!validTimezone(tz)) return { error: "Unknown timezone (use a name like Asia/Karachi)." };
  const workDays = form.getAll("work_days").map(Number);
  if (!workDays.length) return { error: "Pick at least one working day." };
  const raw = {
    timezone: tz,
    workDays,
    startTime: str(form, "start_time"),
    endTime: str(form, "end_time"),
    graceMinutes: num(form, "grace_minutes"),
    allowance: { sick: num(form, "al_sick"), casual: num(form, "al_casual"), annual: num(form, "al_annual"), half_day: num(form, "al_half_day"), wfh_per_month: num(form, "al_wfh") },
    noticeDays: { sick: num(form, "no_sick"), casual: num(form, "no_casual"), annual: num(form, "no_annual"), half_day: num(form, "no_half_day"), wfh: num(form, "no_wfh") },
    sickNoteAfterDays: num(form, "sick_note_after"),
    sickBackdateDays: num(form, "sick_backdate"),
    idleMinutes: num(form, "idle_minutes"),
  };
  const policy = normalizePolicy(raw);
  // normalizePolicy silently falls back on bad values; tell the admin instead.
  if (policy.startTime !== raw.startTime || policy.endTime !== raw.endTime) return { error: "Office hours must be HH:MM (24-hour)." };
  if (JSON.stringify(policy.allowance) !== JSON.stringify(raw.allowance) || JSON.stringify(policy.noticeDays) !== JSON.stringify(raw.noticeDays))
    return { error: "Allowances and notice must be whole numbers from 0 to 60 (WFH up to 31)." };
  const ctx = await hrContext();
  await ctx.store.savePolicy(policy, a.email);
  await audit({ action: "hr.policy_save", actor: a, target: "hr_settings", detail: policy });
  refresh();
  return { ok: true, message: "Saved." };
}

export async function savePersonAction(_: FormState, form: FormData): Promise<FormState> {
  const a = await manager();
  if (!a) return NO;
  const email = str(form, "email").toLowerCase();
  const ctx = await hrContext();
  const p = await findPerson(ctx, email);
  if (!p) return { error: "That person doesn't have an account." };
  const deviceUserId = str(form, "device_user_id") || null;
  if (deviceUserId && !/^[0-9A-Za-z_-]{1,24}$/.test(deviceUserId)) return { error: "Machine ID: letters and numbers only." };
  const opening: Opening = { sick: num(form, "op_sick"), casual: num(form, "op_casual"), annual: num(form, "op_annual"), half_day: num(form, "op_half_day") };
  if (Object.values(opening).some((v) => !Number.isFinite(v) || v < 0 || v > 60 || (v * 2) % 1 !== 0)) return { error: "Leave already taken: numbers from 0 to 60 (halves allowed)." };
  const people = await ctx.store.listPeople();
  if (deviceUserId && people.some((x) => x.deviceUserId === deviceUserId && x.email !== email)) return { error: `Machine ID ${deviceUserId} is already given to someone else.` };
  await ctx.store.savePerson({
    email,
    displayName: str(form, "display_name").slice(0, 80) || null,
    deviceUserId,
    tracked: form.get("tracked") === "on",
    openingYear: Number(ctx.today.slice(0, 4)),
    opening,
  });
  await audit({ action: "hr.person_save", actor: a, target: email, detail: { device_user_id: deviceUserId, tracked: form.get("tracked") === "on", opening } });
  refresh();
  return { ok: true, message: "Saved." };
}

export async function addHolidayAction(_: FormState, form: FormData): Promise<FormState> {
  const a = await manager();
  if (!a) return NO;
  const day = str(form, "day");
  const name = str(form, "name").slice(0, 80);
  if (!YMD.test(day) || !name) return { error: "Pick a date and give the holiday a name." };
  const ctx = await hrContext();
  await ctx.store.addHoliday({ day, name });
  await audit({ action: "hr.holiday_add", actor: a, target: day, detail: { name } });
  refresh();
  return { ok: true, message: `Added ${name}.` };
}

export async function removeHolidayAction(form: FormData): Promise<void> {
  const a = await manager();
  if (!a) return;
  const day = str(form, "day");
  if (!YMD.test(day)) return;
  const ctx = await hrContext();
  await ctx.store.removeHoliday(day);
  await audit({ action: "hr.holiday_remove", actor: a, target: day });
  refresh();
}

/** The machine's attendance log exported to a USB stick ("…attlog.dat"), for when the bridge isn't running. */
export async function uploadPunchesAction(_: FormState, form: FormData): Promise<FormState> {
  const a = await manager();
  if (!a) return NO;
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the attlog file from the machine's USB export." };
  if (file.size > 5_000_000) return { error: "That file is too big (over 5 MB)." };
  const { punches, skipped } = parseAttlog(await file.text());
  if (!punches.length) return { error: "No attendance lines found. Use the attendance log file (attlog.dat) from the machine's USB export." };
  const ctx = await hrContext();
  const added = await ctx.store.addPunches(
    punches.map((p) => ({ deviceUserId: p.deviceUserId, date: p.date, time: p.time })),
    "upload",
    file.name.slice(0, 80),
  );
  await audit({ action: "hr.punches_upload", actor: a, target: file.name.slice(0, 80), detail: { lines: punches.length, added, skipped } });
  refresh();
  return { ok: true, message: `${added} new punch${added === 1 ? "" : "es"} added (${punches.length - added} already there${skipped ? `, ${skipped} unreadable lines skipped` : ""}).` };
}
