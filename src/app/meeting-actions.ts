"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { MAX_NOTES_CHARS, analyzeMeeting } from "@/lib/meetings/analyze";
import { TASK_PRIORITIES, TASK_STATUSES, meetingStore, type Task, type TaskPriority, type TaskStatus } from "@/lib/meetings/store";
import { assignableEmails, can, canSeeTask, taskScope, type Access } from "@/lib/rbac";

export type FormState = { ok?: boolean; error?: string; message?: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const NO = { error: "You don't have access to do that." };

function refresh(brand: string) {
  revalidatePath(`/dashboard/${brand}`, "layout");
  revalidatePath("/tasks");
}

/**
 * Owner field → owner_email (a teammate this person may assign to on this brand) or
 * owner_name (someone outside the team, e.g. the client). Emails they can't assign are refused.
 */
async function resolveOwner(a: Access, brand: string, raw: string): Promise<{ ownerEmail: string | null; ownerName: string | null } | { error: string }> {
  if (!raw) return { ownerEmail: null, ownerName: null };
  const allowed = assignableEmails(a, await meetingStore().brandMembers(brand));
  const lower = raw.toLowerCase();
  if (allowed.includes(lower)) return { ownerEmail: lower, ownerName: null };
  if (raw.includes("@")) return { error: `You can't assign tasks to ${raw} on this brand.` };
  return { ownerEmail: null, ownerName: raw.slice(0, 120) };
}

/** The task, if this person may see it (else null — treated as not found). */
async function visibleTask(a: Access, id: string): Promise<Task | null> {
  const t = await meetingStore({ asUser: true }).getTask(id);
  return t && canSeeTask(a, t) ? t : null;
}

// ── Meetings ────────────────────────────────────────────────────────────

export async function createMeeting(_: FormState, form: FormData): Promise<FormState> {
  const a = await requireAccess();
  const brand = str(form, "brand");
  if (!can(a, "meetings.edit", brand)) return NO;
  const title = str(form, "title") || "Weekly call";
  const date = str(form, "meeting_date");
  const notes = str(form, "notes");
  if (!YMD.test(date)) return { error: "Pick the meeting date." };
  if (notes.length < 20) return { error: "Paste the meeting notes or transcript (at least a few lines)." };
  if (notes.length > MAX_NOTES_CHARS) return { error: `Notes are too long (${notes.length.toLocaleString()} characters; max ${MAX_NOTES_CHARS.toLocaleString()}). Split them into two meetings.` };

  let id: string;
  try {
    const { meeting } = await meetingStore().createMeeting({
      brandSlug: brand,
      title: title.slice(0, 200),
      meetingDate: date,
      notes,
      source: "paste",
      createdBy: a.email,
    });
    id = meeting.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the meeting." };
  }
  await audit({ action: "meeting.create", actor: a, brand, target: id, detail: { title, chars: notes.length } });
  // Claude runs after the response is sent; the meeting page polls until it's done.
  after(() => analyzeMeeting(id));
  refresh(brand);
  redirect(`/dashboard/${brand}/meetings/${id}`);
}

async function editableMeeting(a: Access, form: FormData) {
  const id = str(form, "id");
  const m = await meetingStore({ asUser: true }).getMeeting(id);
  return m && can(a, "meetings.edit", m.brandSlug) ? m : null;
}

export async function reanalyzeMeeting(form: FormData) {
  const a = await requireAccess();
  const m = await editableMeeting(a, form);
  if (!m) return;
  await meetingStore().updateMeeting(m.id, { status: "pending", error: null });
  await audit({ action: "meeting.reanalyze", actor: a, brand: m.brandSlug, target: m.id });
  after(() => analyzeMeeting(m.id));
  refresh(m.brandSlug);
}

export async function deleteMeeting(form: FormData) {
  const a = await requireAccess();
  const m = await editableMeeting(a, form);
  if (!m) return;
  await meetingStore().deleteMeeting(m.id);
  await audit({ action: "meeting.delete", actor: a, brand: m.brandSlug, target: m.id, detail: { title: m.title } });
  refresh(m.brandSlug);
  redirect(`/dashboard/${m.brandSlug}/meetings`);
}

// ── Tasks ───────────────────────────────────────────────────────────────

export async function createTask(_: FormState, form: FormData): Promise<FormState> {
  const a = await requireAccess();
  const brand = str(form, "brand");
  if (!can(a, "tasks.view", brand)) return NO;
  const title = str(form, "title");
  const due = str(form, "due_date");
  const priority = str(form, "priority") as TaskPriority;
  if (!title) return { error: "Give the task a title." };
  if (due && !YMD.test(due)) return { error: "Invalid due date." };
  const owner = await resolveOwner(a, brand, str(form, "owner"));
  if ("error" in owner) return owner;
  const meetingId = str(form, "meeting_id") || null;
  if (meetingId) {
    const m = await meetingStore({ asUser: true }).getMeeting(meetingId);
    if (!m || m.brandSlug !== brand) return NO;
  }
  // People who only see their own tasks can't create tasks they wouldn't be able to see.
  if (taskScope(a) === "own" && owner.ownerEmail && owner.ownerEmail !== a.email) return NO;
  try {
    const [t] = await meetingStore().createTasks([
      {
        brandSlug: brand,
        meetingId,
        title: title.slice(0, 300),
        detail: str(form, "detail") || null,
        ...owner,
        dueDate: due || null,
        priority: TASK_PRIORITIES.includes(priority) ? priority : "medium",
        source: "manual",
        createdBy: a.email,
      },
    ]);
    await audit({ action: "task.create", actor: a, brand, target: t.id, detail: { title: t.title, owner: t.ownerEmail ?? t.ownerName } });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the task." };
  }
  refresh(brand);
  return { ok: true, message: "Task added." };
}

export async function setTaskStatus(form: FormData) {
  const a = await requireAccess();
  const status = str(form, "status") as TaskStatus;
  if (!TASK_STATUSES.includes(status)) return;
  const t = await visibleTask(a, str(form, "id"));
  if (!t) return;
  await meetingStore().updateTask(t.id, { status });
  await audit({ action: "task.status", actor: a, brand: t.brandSlug, target: t.id, detail: { from: t.status, to: status } });
  refresh(t.brandSlug);
}

export async function updateTask(_: FormState, form: FormData): Promise<FormState> {
  const a = await requireAccess();
  const t = await visibleTask(a, str(form, "id"));
  if (!t) return NO;
  const title = str(form, "title");
  const due = str(form, "due_date");
  const priority = str(form, "priority") as TaskPriority;
  if (!title) return { error: "Title can't be empty." };
  if (due && !YMD.test(due)) return { error: "Invalid due date." };
  const rawOwner = str(form, "owner");
  const unchanged = rawOwner.toLowerCase() === (t.ownerEmail ?? t.ownerName ?? "").toLowerCase();
  const owner = unchanged ? { ownerEmail: t.ownerEmail, ownerName: t.ownerName } : await resolveOwner(a, t.brandSlug, rawOwner);
  if ("error" in owner) return owner;
  await meetingStore().updateTask(t.id, {
    title: title.slice(0, 300),
    detail: str(form, "detail") || null,
    ...owner,
    dueDate: due || null,
    priority: TASK_PRIORITIES.includes(priority) ? priority : "medium",
  });
  await audit({ action: "task.update", actor: a, brand: t.brandSlug, target: t.id, detail: { title, owner: owner.ownerEmail ?? owner.ownerName } });
  refresh(t.brandSlug);
  return { ok: true, message: "Saved." };
}

export async function deleteTask(form: FormData) {
  const a = await requireAccess();
  const t = await visibleTask(a, str(form, "id"));
  // Managers delete any task they can see; everyone else only tasks they created.
  if (!t || (taskScope(a) !== "all" && t.createdBy?.toLowerCase() !== a.email)) return;
  await meetingStore().deleteTask(t.id);
  await audit({ action: "task.delete", actor: a, brand: t.brandSlug, target: t.id, detail: { title: t.title } });
  refresh(t.brandSlug);
}
