"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { MAX_NOTES_CHARS, analyzeMeeting } from "@/lib/meetings/analyze";
import { TASK_PRIORITIES, TASK_STATUSES, meetingStore, type TaskPriority, type TaskStatus } from "@/lib/meetings/store";

export type FormState = { ok?: boolean; error?: string; message?: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

function refresh(brand: string) {
  revalidatePath(`/dashboard/${brand}`, "layout");
  revalidatePath("/tasks");
}

/** "someone@x.com" → owner_email when on the team; anything else is a free-text owner. */
async function owner(raw: string) {
  if (!raw) return { ownerEmail: null, ownerName: null };
  const team = (await meetingStore().teamEmails()).map((e) => e.toLowerCase());
  const lower = raw.toLowerCase();
  return team.includes(lower) ? { ownerEmail: lower, ownerName: null } : { ownerEmail: null, ownerName: raw.slice(0, 120) };
}

export async function createMeeting(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const brand = str(form, "brand");
  const title = str(form, "title") || "Weekly call";
  const date = str(form, "meeting_date");
  const notes = str(form, "notes");
  if (!brand) return { error: "Missing brand." };
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
      createdBy: user.email,
    });
    id = meeting.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the meeting." };
  }
  // Claude runs after the response is sent; the meeting page polls until it's done.
  after(() => analyzeMeeting(id));
  refresh(brand);
  redirect(`/dashboard/${brand}/meetings/${id}`);
}

export async function reanalyzeMeeting(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  const brand = str(form, "brand");
  await meetingStore().updateMeeting(id, { status: "pending", error: null });
  after(() => analyzeMeeting(id));
  refresh(brand);
}

export async function deleteMeeting(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  const brand = str(form, "brand");
  await meetingStore().deleteMeeting(id);
  refresh(brand);
  redirect(`/dashboard/${brand}/meetings`);
}

export async function createTask(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const brand = str(form, "brand");
  const title = str(form, "title");
  const due = str(form, "due_date");
  const priority = str(form, "priority") as TaskPriority;
  if (!brand || !title) return { error: "Give the task a title." };
  if (due && !YMD.test(due)) return { error: "Invalid due date." };
  try {
    await meetingStore().createTasks([
      {
        brandSlug: brand,
        meetingId: str(form, "meeting_id") || null,
        title: title.slice(0, 300),
        detail: str(form, "detail") || null,
        ...(await owner(str(form, "owner"))),
        dueDate: due || null,
        priority: TASK_PRIORITIES.includes(priority) ? priority : "medium",
        source: "manual",
        createdBy: user.email,
      },
    ]);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the task." };
  }
  refresh(brand);
  return { ok: true, message: "Task added." };
}

export async function setTaskStatus(form: FormData) {
  await requireUser();
  const status = str(form, "status") as TaskStatus;
  if (!TASK_STATUSES.includes(status)) return;
  await meetingStore().updateTask(str(form, "id"), { status });
  refresh(str(form, "brand"));
}

export async function updateTask(_: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const id = str(form, "id");
  const brand = str(form, "brand");
  const title = str(form, "title");
  const due = str(form, "due_date");
  const priority = str(form, "priority") as TaskPriority;
  if (!title) return { error: "Title can't be empty." };
  if (due && !YMD.test(due)) return { error: "Invalid due date." };
  await meetingStore().updateTask(id, {
    title: title.slice(0, 300),
    detail: str(form, "detail") || null,
    ...(await owner(str(form, "owner"))),
    dueDate: due || null,
    priority: TASK_PRIORITIES.includes(priority) ? priority : "medium",
  });
  refresh(brand);
  return { ok: true, message: "Saved." };
}

export async function deleteTask(form: FormData) {
  await requireUser();
  await meetingStore().deleteTask(str(form, "id"));
  refresh(str(form, "brand"));
}
