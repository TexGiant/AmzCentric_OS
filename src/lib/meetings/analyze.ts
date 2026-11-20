import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { demoSource } from "@/lib/data/demo";
import { adminSource } from "@/lib/data/supabase";
import type { DataSource } from "@/lib/data/types";
import { addDays, daysInMonth, monthStart, shortDate, todayInTz } from "@/lib/dates";
import { isDemoMode } from "@/lib/env";
import { acos, change, cvr, sum, type Totals } from "@/lib/metrics";
import { INSIGHT_TYPES, TASK_PRIORITIES, meetingStore, type Insight, type Meeting, type NewTask, type Task } from "@/lib/meetings/store";

/*
 * Turns a meeting's notes into a summary, insights, tasks and next week's agenda with Claude.
 * Claude sees the brand's live numbers and open tasks, so insights can cite real figures,
 * tasks aren't duplicated, and tasks the meeting says are finished get closed.
 */

const MODEL = "claude-opus-5-5";
export const MAX_NOTES_CHARS = 400_000;

export function analysisEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const AnalysisSchema = z.object({
  summary: z.string().describe("3–5 sentences: what happened, what was decided, what matters most this week."),
  insights: z.array(
    z.object({
      type: z.enum(INSIGHT_TYPES),
      title: z.string().describe("One line."),
      detail: z.string().describe("1–2 sentences. Cite numbers from the notes or the brand data when relevant."),
    }),
  ),
  tasks: z.array(
    z.object({
      title: z.string().describe("Starts with a verb; specific enough to act on without the notes."),
      detail: z.string().nullable(),
      owner_email: z.string().nullable().describe("Only an email from the team list, when the owner is clearly that teammate."),
      owner_name: z.string().nullable().describe("Owner who is not on the team list (e.g. the client), as named in the notes."),
      due_date: z.string().nullable().describe("YYYY-MM-DD, resolved from phrases like 'by Friday' relative to the meeting date. Null if none was given."),
      priority: z.enum(TASK_PRIORITIES),
    }),
  ),
  completed_tasks: z
    .array(z.object({ id: z.string(), evidence: z.string().describe("What in the notes shows it is done.") }))
    .describe("Open tasks from the list that the notes clearly say are finished."),
  next_meeting_agenda: z.array(z.string()).describe("Short follow-ups to check at the next meeting."),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

const SYSTEM = `You are the account analyst at AmzCentric, an Amazon advertising agency. After each weekly call with a client brand, you turn the meeting notes or transcript into a record the team works from.

You get the notes, the brand's current Amazon Ads numbers, the team's emails, and the brand's open tasks.

- Summary and insights come from what was said in the meeting. Use the brand data to add numbers or to point out where something said on the call disagrees with the data. Don't invent facts that are in neither.
- Insight types: win (something that worked), risk (a problem or threat), opportunity (room to grow), decision (agreed on the call), client_request (something the client asked for).
- Create a task for each concrete commitment or next step, including ones the client owns. Skip vague ideas nobody committed to. Don't create a task that duplicates an open task; if the call changed an open task, it's fine to leave it alone.
- Assign owner_email only when the notes clearly point to that teammate (by name or email). Otherwise use owner_name, or leave both null.
- Priority: high for anything that is costing money now, is time-sensitive, or that the client stressed; low for nice-to-haves.
- List an open task in completed_tasks only when the notes clearly say it is done.
- Write plainly and briefly. Money in USD with cents where given.`;

function fmtTotals(t: Totals) {
  const a = acos(t);
  const c = cvr(t);
  return `spend $${t.cost.toFixed(2)}, ad sales $${t.sales.toFixed(2)}, ACOS ${a == null ? "n/a" : `${(a * 100).toFixed(1)}%`}, orders ${t.orders}, clicks ${t.clicks}, CVR ${c == null ? "n/a" : `${(c * 100).toFixed(1)}%`}`;
}

const pctChange = (a: number | null, b: number | null) => {
  const c = change(a, b);
  return c == null ? "n/a" : `${c >= 0 ? "+" : ""}${(c * 100).toFixed(0)}%`;
};

/** A compact snapshot of the brand's numbers for the prompt. */
async function brandContext(ds: DataSource, slug: string): Promise<string> {
  try {
    const status = await ds.brandStatus(slug);
    const today = todayInTz(status.timezone);
    const yesterday = addDays(today, -1);
    const through = status.dataThrough && status.dataThrough < yesterday ? status.dataThrough : yesterday;
    const from7 = addDays(through, -6);
    const [now, prev, actions, goal, month] = await Promise.all([
      ds.campaigns(slug, from7, through),
      ds.campaigns(slug, addDays(from7, -7), addDays(from7, -1)),
      ds.actions(slug, 15),
      ds.goal(slug, monthStart(through)),
      ds.brandDaily(slug, monthStart(through), through),
    ]);
    const t = sum(now);
    const p = sum(prev);
    const lines = [
      `Data through ${through} (marketplace time).`,
      `Last 7 days (${from7} to ${through}): ${fmtTotals(t)}.`,
      `Prior 7 days: ${fmtTotals(p)}. Change: spend ${pctChange(t.cost, p.cost)}, sales ${pctChange(t.sales, p.sales)}, ACOS ${pctChange(acos(t), acos(p))}.`,
    ];
    const top = [...now].sort((a, b) => b.cost - a.cost).slice(0, 10);
    if (top.length) {
      lines.push("Top campaigns by spend, last 7 days:");
      for (const c of top) lines.push(`- ${c.name} [${c.adProduct}, ${c.state}]: ${fmtTotals(c)}`);
    }
    const wasted = now.filter((c) => c.cost >= 20 && c.orders === 0);
    if (wasted.length) lines.push(`Campaigns with $20+ spend and no orders: ${wasted.map((c) => `${c.name} ($${c.cost.toFixed(2)})`).join("; ")}.`);
    if (goal) {
      const m = sum(month);
      const day = Number(through.slice(8, 10));
      const dim = daysInMonth(through);
      const parts = [];
      // Same basis as the Goals page: total sales when SP-API provides them, else ad sales.
      const hasTotal = month.some((d) => d.totalSales != null);
      const mtdSales = hasTotal ? (m.totalSales ?? 0) : m.sales;
      if (goal.salesTarget)
        parts.push(
          `${hasTotal ? "total" : "ad"} sales target $${goal.salesTarget} (month to date $${mtdSales.toFixed(2)}, ${((mtdSales / goal.salesTarget) * 100).toFixed(0)}% of target with ${((day / dim) * 100).toFixed(0)}% of the month gone)`,
        );
      if (goal.spendBudget) parts.push(`spend budget $${goal.spendBudget} (month to date $${m.cost.toFixed(2)})`);
      if (goal.acosTarget) parts.push(`ACOS target ${(goal.acosTarget * 100).toFixed(1)}% (month to date ${acos(m) == null ? "n/a" : `${(acos(m)! * 100).toFixed(1)}%`})`);
      if (parts.length) lines.push(`Monthly goals: ${parts.join("; ")}.`);
    }
    if (actions.length) {
      lines.push("Recent changes in the Action Log:");
      for (const a of actions.slice(0, 10)) lines.push(`- ${a.actionDate}: ${a.description}${a.campaignName ? ` (${a.campaignName})` : ""}`);
    }
    return lines.join("\n");
  } catch (e) {
    return `Brand data unavailable (${e instanceof Error ? e.message : "error"}).`;
  }
}

function buildPrompt(m: Meeting, brandName: string, context: string, team: string[], openTasks: Task[]): string {
  const tasks = openTasks.length
    ? openTasks
        .map((t) => `- id ${t.id}: ${t.title}${t.ownerEmail || t.ownerName ? ` (owner: ${t.ownerEmail ?? t.ownerName})` : ""}${t.dueDate ? `, due ${t.dueDate}` : ""}`)
        .join("\n")
    : "(none)";
  return `Brand: ${brandName}
Meeting: ${m.title}
Meeting date: ${m.meetingDate} (${new Date(`${m.meetingDate}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })})

<team_emails>
${team.join("\n") || "(none)"}
</team_emails>

<brand_data>
${context}
</brand_data>

<open_tasks>
${tasks}
</open_tasks>

<meeting_notes>
${m.notes}
</meeting_notes>`;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Saves an analysis (from Claude here, or from Claude in chat via the connector). */
export async function applyAnalysis(
  meeting: Meeting,
  a: Partial<Analysis>,
  opts: { source: "ai" | "claude"; createdBy: string | null },
): Promise<{ created: Task[]; closed: Task[] }> {
  const store = meetingStore();
  const team = new Set((await store.teamEmails()).map((e) => e.toLowerCase()));
  const open = await store.listTasks({ brand: meeting.brandSlug, status: ["open", "in_progress"] });
  const openIds = new Set(open.map((t) => t.id));

  const newTasks: NewTask[] = (a.tasks ?? [])
    .filter((t) => t.title?.trim())
    .map((t) => {
      const email = t.owner_email?.trim().toLowerCase() || null;
      const onTeam = email && team.has(email);
      return {
        brandSlug: meeting.brandSlug,
        meetingId: meeting.id,
        title: t.title.trim().slice(0, 300),
        detail: t.detail?.trim() || null,
        ownerEmail: onTeam ? email : null,
        ownerName: onTeam ? null : t.owner_name?.trim() || t.owner_email?.trim() || null,
        dueDate: t.due_date && YMD.test(t.due_date) && !Number.isNaN(Date.parse(t.due_date)) ? t.due_date : null,
        priority: TASK_PRIORITIES.includes(t.priority) ? t.priority : "medium",
        source: opts.source,
        createdBy: opts.createdBy,
      };
    });
  const created = await store.createTasks(newTasks);

  const closed: Task[] = [];
  for (const c of a.completed_tasks ?? []) {
    if (!openIds.has(c.id)) continue;
    const t = await store.updateTask(c.id, {
      status: "done",
      completedNote: `Marked done from the ${shortDate(meeting.meetingDate)} meeting: ${c.evidence}`.slice(0, 500),
    });
    if (t) closed.push(t);
  }

  const insights: Insight[] = (a.insights ?? []).filter((i) => i.title?.trim()).map((i) => ({ type: i.type, title: i.title.trim(), detail: i.detail?.trim() ?? "" }));
  await store.updateMeeting(meeting.id, {
    status: "done",
    summary: a.summary?.trim() || null,
    insights,
    agenda: (a.next_meeting_agenda ?? []).map((s) => s.trim()).filter(Boolean),
    error: null,
    analyzedAt: new Date().toISOString(),
  });
  return { created, closed };
}

/**
 * Runs Claude over a saved meeting and stores the result. Never throws: failures are
 * recorded on the meeting (status "failed") so the page can show them and offer a retry.
 */
export async function analyzeMeeting(meetingId: string): Promise<void> {
  const store = meetingStore();
  const meeting = await store.getMeeting(meetingId);
  if (!meeting) return;
  if (!analysisEnabled()) {
    await store.updateMeeting(meetingId, {
      status: "skipped",
      error: "Automatic analysis is off: add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables, redeploy, then press Analyze.",
    });
    return;
  }
  await store.updateMeeting(meetingId, { status: "processing", error: null });

  try {
    const ds: DataSource = isDemoMode() ? demoSource : adminSource;
    const brands = await ds.listBrands();
    const brandName = brands.find((b) => b.slug === meeting.brandSlug)?.name ?? meeting.brandSlug;
    const [context, team, open] = await Promise.all([
      brandContext(ds, meeting.brandSlug),
      store.teamEmails(),
      store.listTasks({ brand: meeting.brandSlug, status: ["open", "in_progress"], limit: 100 }),
    ]);

    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(AnalysisSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(meeting, brandName, context, team, open) }],
    });

    if (response.stop_reason === "refusal") throw new Error("Claude declined to analyze these notes.");
    if (response.stop_reason === "max_tokens") throw new Error("The analysis ran out of room. Try splitting very long notes.");
    const parsed = response.parsed_output;
    if (!parsed) throw new Error("Claude's answer couldn't be read. Press Analyze to try again.");

    await applyAnalysis(meeting, parsed, { source: "ai", createdBy: null });
  } catch (e) {
    let message = e instanceof Error ? e.message : "Analysis failed.";
    if (e instanceof Anthropic.AuthenticationError) message = "The ANTHROPIC_API_KEY was rejected. Check the key in Vercel.";
    else if (e instanceof Anthropic.RateLimitError) message = "Claude API rate limit hit. Press Analyze again in a minute.";
    else if (e instanceof Anthropic.APIError) message = `Claude API error${e.status ? ` (${e.status})` : ""}: ${e.message}`;
    console.error("meeting analysis failed", meetingId, e);
    await store.updateMeeting(meetingId, { status: "failed", error: message.slice(0, 1000) });
  }
}
