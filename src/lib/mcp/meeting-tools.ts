import "server-only";
import { after } from "next/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Brand } from "@/lib/data/types";
import { siteUrl } from "@/lib/env";
import { MAX_NOTES_CHARS, analysisEnabled, analyzeMeeting, applyAnalysis } from "@/lib/meetings/analyze";
import { INSIGHT_TYPES, TASK_PRIORITIES, TASK_STATUSES, meetingStore, type Meeting, type Task, type TaskPatch } from "@/lib/meetings/store";
import type { McpUser } from "@/lib/oauth";

/* Meetings + tasks tools for the AmzCentric OS connector. */

type Deps = {
  user: McpUser;
  brandOf: (input: string) => Promise<Brand>;
  today: (slug: string) => Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: <A>(fn: (args: A) => Promise<unknown>) => (args: A) => Promise<any>;
  fail: (message: string) => never;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymd = z.string().regex(YMD, "Use YYYY-MM-DD");

const taskOut = (t: Task) => ({
  id: t.id,
  brand: t.brandSlug,
  title: t.title,
  detail: t.detail,
  owner: t.ownerEmail ?? t.ownerName,
  due_date: t.dueDate,
  priority: t.priority,
  status: t.status,
  source: t.source,
  meeting_id: t.meetingId,
  completed_at: t.completedAt,
  completed_note: t.completedNote,
});

const meetingUrl = (m: Meeting) => `${siteUrl()}/dashboard/${m.brandSlug}/meetings/${m.id}`;

/** "ali@amzcentric.com" → owner_email; anything else → owner_name. */
const splitOwner = (owner?: string | null) => {
  const o = owner?.trim();
  if (!o) return { owner_email: null, owner_name: null };
  return o.includes("@") ? { owner_email: o.toLowerCase(), owner_name: null } : { owner_email: null, owner_name: o };
};

export function registerMeetingTools(server: McpServer, d: Deps) {
  const store = meetingStore();
  const READ = { readOnlyHint: true, openWorldHint: false } as const;
  const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

  async function ownerFor(owner: string | null | undefined) {
    const s = splitOwner(owner);
    if (s.owner_email) {
      const team = (await store.teamEmails()).map((e) => e.toLowerCase());
      if (!team.includes(s.owner_email)) return { ownerEmail: null, ownerName: owner!.trim() };
      return { ownerEmail: s.owner_email, ownerName: null };
    }
    return { ownerEmail: null, ownerName: s.owner_name };
  }

  server.registerTool(
    "save_meeting_notes",
    {
      title: "Save meeting notes",
      description:
        "Save a brand meeting (weekly client call) to the brand's Meetings tab, with the summary, insights and tasks you extracted. " +
        "Pass the full notes or transcript in `notes`. Include `summary`, `insights` and `tasks` whenever you can — they are saved as-is under the signed-in teammate. " +
        "If you pass only notes, the app analyzes them itself when its Claude API key is set. Call list_tasks first to avoid duplicating open tasks, and pass ids the meeting says are finished in `completed_task_ids`. " +
        "Owners: a teammate's email (from list_tasks / the team) or a name such as the client's.",
      inputSchema: {
        brand: z.string().describe("Brand slug or name"),
        notes: z.string().min(20).max(MAX_NOTES_CHARS).describe("Full meeting notes or transcript"),
        title: z.string().max(200).optional().describe("Default 'Weekly call'"),
        meeting_date: ymd.optional().describe("Default today (marketplace time)"),
        summary: z.string().max(4000).optional().describe("3–5 sentence summary"),
        insights: z
          .array(z.object({ type: z.enum(INSIGHT_TYPES), title: z.string().max(300), detail: z.string().max(1000).optional() }))
          .max(30)
          .optional()
          .describe("win | risk | opportunity | decision | client_request"),
        tasks: z
          .array(
            z.object({
              title: z.string().min(3).max(300),
              detail: z.string().max(1000).optional(),
              owner: z.string().max(200).optional(),
              due_date: ymd.optional(),
              priority: z.enum(TASK_PRIORITIES).optional(),
            }),
          )
          .max(50)
          .optional(),
        completed_task_ids: z.array(z.string()).max(50).optional().describe("Open task ids this meeting says are done"),
        next_meeting_agenda: z.array(z.string().max(300)).max(20).optional(),
      },
      annotations: WRITE,
    },
    d.run(
      async (a: {
        brand: string;
        notes: string;
        title?: string;
        meeting_date?: string;
        summary?: string;
        insights?: Array<{ type: (typeof INSIGHT_TYPES)[number]; title: string; detail?: string }>;
        tasks?: Array<{ title: string; detail?: string; owner?: string; due_date?: string; priority?: (typeof TASK_PRIORITIES)[number] }>;
        completed_task_ids?: string[];
        next_meeting_agenda?: string[];
      }) => {
        const b = await d.brandOf(a.brand);
        const date = a.meeting_date ?? (await d.today(b.slug));
        const provided = Boolean(a.summary || a.insights?.length || a.tasks?.length);
        const { meeting } = await store.createMeeting({
          brandSlug: b.slug,
          title: a.title?.trim() || "Weekly call",
          meetingDate: date,
          notes: a.notes,
          source: "claude",
          createdBy: d.user.email,
          status: provided ? "processing" : "pending",
        });

        if (provided) {
          const { created, closed } = await applyAnalysis(
            meeting,
            {
              summary: a.summary ?? "",
              insights: (a.insights ?? []).map((i) => ({ type: i.type, title: i.title, detail: i.detail ?? "" })),
              tasks: (a.tasks ?? []).map((t) => ({
                title: t.title,
                detail: t.detail ?? null,
                ...splitOwner(t.owner),
                due_date: t.due_date ?? null,
                priority: t.priority ?? "medium",
              })),
              completed_tasks: (a.completed_task_ids ?? []).map((id) => ({ id, evidence: "noted in the meeting" })),
              next_meeting_agenda: a.next_meeting_agenda ?? [],
            },
            { source: "claude", createdBy: d.user.email },
          );
          return {
            saved: true,
            meeting_id: meeting.id,
            url: meetingUrl(meeting),
            brand: b.name,
            tasks_created: created.map(taskOut),
            tasks_closed: closed.map((t) => ({ id: t.id, title: t.title })),
          };
        }

        if (analysisEnabled()) {
          after(() => analyzeMeeting(meeting.id));
          return {
            saved: true,
            meeting_id: meeting.id,
            url: meetingUrl(meeting),
            brand: b.name,
            note: "Notes saved; the app is generating the summary, insights and tasks now (about a minute). Use get_meeting to read them.",
          };
        }
        await store.updateMeeting(meeting.id, { status: "skipped", error: "Saved from Claude without a summary or tasks." });
        return {
          saved: true,
          meeting_id: meeting.id,
          url: meetingUrl(meeting),
          brand: b.name,
          note: "Notes saved, but the app's own analysis is off. Extract the tasks yourself and add them with create_task (pass this meeting_id).",
        };
      },
    ),
  );

  server.registerTool(
    "list_meetings",
    {
      title: "List meetings",
      description: "A brand's recent meetings with summary, insights, next-meeting agenda and task counts (newest first). Use get_meeting for the full notes.",
      inputSchema: { brand: z.string().describe("Brand slug or name"), limit: z.number().int().min(1).max(50).optional().describe("Default 10") },
      annotations: READ,
    },
    d.run(async (a: { brand: string; limit?: number }) => {
      const b = await d.brandOf(a.brand);
      const [meetings, tasks] = await Promise.all([store.listMeetings(b.slug, a.limit ?? 10), store.listTasks({ brand: b.slug })]);
      return {
        brand: b.name,
        meetings: meetings.map((m) => {
          const mine = tasks.filter((t) => t.meetingId === m.id);
          return {
            id: m.id,
            title: m.title,
            date: m.meetingDate,
            status: m.status,
            source: m.source,
            summary: m.summary,
            insights: m.insights,
            next_meeting_agenda: m.agenda,
            tasks: mine.length,
            open_tasks: mine.filter((t) => t.status !== "done").length,
            url: meetingUrl(m),
          };
        }),
      };
    }),
  );

  server.registerTool(
    "get_meeting",
    {
      title: "Get a meeting",
      description: "One meeting with its full notes, summary, insights, agenda and tasks.",
      inputSchema: { meeting_id: z.string().describe("From list_meetings") },
      annotations: READ,
    },
    d.run(async (a: { meeting_id: string }) => {
      const m = await store.getMeeting(a.meeting_id.trim());
      if (!m) d.fail(`No meeting with id ${a.meeting_id}.`);
      const tasks = await store.listTasks({ meetingId: m!.id });
      return {
        id: m!.id,
        brand: m!.brandSlug,
        title: m!.title,
        date: m!.meetingDate,
        status: m!.status,
        error: m!.error,
        summary: m!.summary,
        insights: m!.insights,
        next_meeting_agenda: m!.agenda,
        tasks: tasks.map(taskOut),
        notes: m!.notes,
        url: meetingUrl(m!),
      };
    }),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "Tasks for one brand or all brands. Default: open and in-progress. owner 'me' = the signed-in teammate. Sorted: in progress, then by due date and priority.",
      inputSchema: {
        brand: z.string().optional().describe("Brand slug or name; omit for every brand"),
        status: z.enum(["open", "done", "all"]).optional().describe("open (default) = open + in progress"),
        owner: z.string().optional().describe("'me', a teammate email, or a name"),
        overdue_only: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional().describe("Default 50"),
      },
      annotations: READ,
    },
    d.run(async (a: { brand?: string; status?: "open" | "done" | "all"; owner?: string; overdue_only?: boolean; limit?: number }) => {
      const b = a.brand ? await d.brandOf(a.brand) : null;
      const status = a.status ?? "open";
      let tasks = await store.listTasks({
        brand: b?.slug,
        status: status === "open" ? ["open", "in_progress"] : status === "done" ? ["done"] : undefined,
      });
      if (a.owner) {
        const o = a.owner.trim().toLowerCase() === "me" ? d.user.email.toLowerCase() : a.owner.trim().toLowerCase();
        tasks = tasks.filter((t) => t.ownerEmail?.toLowerCase() === o || t.ownerName?.toLowerCase().includes(o) || t.ownerEmail?.split("@")[0] === o);
      }
      const today = await d.today(b?.slug ?? "");
      if (a.overdue_only) tasks = tasks.filter((t) => t.status !== "done" && t.dueDate && t.dueDate < today);
      return { today, count: tasks.length, tasks: tasks.slice(0, a.limit ?? 50).map(taskOut), team: await store.teamEmails() };
    }),
  );

  server.registerTool(
    "create_task",
    {
      title: "Create a task",
      description: "Add a task to a brand's Tasks tab, created by the signed-in teammate. Owner: a teammate email or a name.",
      inputSchema: {
        brand: z.string().describe("Brand slug or name"),
        title: z.string().min(3).max(300).describe("Starts with a verb"),
        detail: z.string().max(1000).optional(),
        owner: z.string().max(200).optional(),
        due_date: ymd.optional(),
        priority: z.enum(TASK_PRIORITIES).optional().describe("Default medium"),
        meeting_id: z.string().optional().describe("Link it to a meeting"),
      },
      annotations: WRITE,
    },
    d.run(async (a: { brand: string; title: string; detail?: string; owner?: string; due_date?: string; priority?: (typeof TASK_PRIORITIES)[number]; meeting_id?: string }) => {
      const b = await d.brandOf(a.brand);
      if (a.meeting_id) {
        const m = await store.getMeeting(a.meeting_id);
        if (!m || m.brandSlug !== b.slug) d.fail(`Meeting ${a.meeting_id} isn't a ${b.name} meeting.`);
      }
      const [t] = await store.createTasks([
        {
          brandSlug: b.slug,
          meetingId: a.meeting_id ?? null,
          title: a.title.trim(),
          detail: a.detail?.trim() || null,
          ...(await ownerFor(a.owner)),
          dueDate: a.due_date ?? null,
          priority: a.priority ?? "medium",
          source: "claude",
          createdBy: d.user.email,
        },
      ]);
      return { created: true, task: taskOut(t), url: `${siteUrl()}/dashboard/${b.slug}/tasks` };
    }),
  );

  server.registerTool(
    "update_task",
    {
      title: "Update a task",
      description: "Change a task's status (open, in_progress, done), owner, due date, priority, title or detail. Use list_tasks to find the id.",
      inputSchema: {
        task_id: z.string(),
        status: z.enum(TASK_STATUSES).optional(),
        note: z.string().max(500).optional().describe("Why it's done (shown with the task)"),
        title: z.string().min(3).max(300).optional(),
        detail: z.string().max(1000).optional(),
        owner: z.string().max(200).optional().describe("Teammate email or a name; empty string clears it"),
        due_date: z.string().optional().describe("YYYY-MM-DD; empty string clears it"),
        priority: z.enum(TASK_PRIORITIES).optional(),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    d.run(
      async (a: {
        task_id: string;
        status?: (typeof TASK_STATUSES)[number];
        note?: string;
        title?: string;
        detail?: string;
        owner?: string;
        due_date?: string;
        priority?: (typeof TASK_PRIORITIES)[number];
      }) => {
        const existing = await store.getTask(a.task_id.trim());
        if (!existing) d.fail(`No task with id ${a.task_id}.`);
        if (a.due_date && !YMD.test(a.due_date)) d.fail("due_date must be YYYY-MM-DD.");
        const patch: TaskPatch = {
          status: a.status,
          title: a.title?.trim(),
          detail: a.detail === undefined ? undefined : a.detail.trim() || null,
          dueDate: a.due_date === undefined ? undefined : a.due_date || null,
          priority: a.priority,
          ...(a.owner === undefined ? {} : await ownerFor(a.owner)),
        };
        let t = await store.updateTask(existing!.id, patch);
        if (t && a.status === "done") t = await store.updateTask(t.id, { completedNote: a.note?.trim() || `Marked done by ${d.user.email} via Claude` });
        return { updated: true, task: taskOut(t!) };
      },
    ),
  );
}
