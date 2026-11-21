import Link from "next/link";
import { Check, Circle, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import { deleteTask, setTaskStatus } from "@/app/meeting-actions";
import { TaskEditForm } from "@/components/meeting-forms";
import { PendingButton } from "@/components/settings-forms";
import { Pill, cn, type Tone } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import type { Task } from "@/lib/meetings/store";

const PRIORITY_TONE: Record<Task["priority"], Tone> = { high: "bad", medium: "warn", low: "neutral" };

function ownerLabel(t: Task) {
  if (t.ownerEmail) return t.ownerEmail.split("@")[0];
  return t.ownerName;
}

function StatusButton({ task, to, title, children, className }: { task: Task; to: Task["status"]; title: string; children: React.ReactNode; className?: string }) {
  return (
    <form action={setTaskStatus}>
      <input type="hidden" name="id" value={task.id} />
      <input type="hidden" name="brand" value={task.brandSlug} />
      <input type="hidden" name="status" value={to} />
      <PendingButton pendingText="" className={className}>
        <span className="sr-only">{title}</span>
        {children}
      </PendingButton>
    </form>
  );
}

const smallBtn =
  "inline-flex h-7 items-center gap-1 rounded-pill border border-line px-2.5 text-[11px] font-bold text-ink-2 transition-colors hover:border-brand hover:text-brand-ink disabled:opacity-60";

export function TaskList({
  tasks,
  team,
  today,
  me,
  canDeleteAll = false,
  brandNames,
  empty = "No tasks yet.",
  showMeetingLink = true,
}: {
  tasks: Task[];
  /** Who each brand's tasks may be assigned to (owner picker), by brand slug or one list for all. */
  team: string[] | Record<string, string[]>;
  today: string;
  /** Signed-in email: people without "all tasks" scope may only delete tasks they created. */
  me?: string;
  canDeleteAll?: boolean;
  /** Show the brand on each row (cross-brand views). */
  brandNames?: Record<string, string>;
  empty?: string;
  showMeetingLink?: boolean;
}) {
  if (!tasks.length) return <p className="px-6 py-8 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {tasks.map((t) => {
        const done = t.status === "done";
        const overdue = !done && t.dueDate && t.dueDate < today;
        const dueSoon = !done && t.dueDate === today;
        return (
          <li key={t.id} className={cn("group px-6 py-3.5", done && "bg-canvas/60")}>
            <div className="flex items-start gap-3">
              <StatusButton
                task={t}
                to={done ? "open" : "done"}
                title={done ? "Reopen" : "Mark done"}
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors",
                  done ? "border-good bg-good text-white" : "border-line-strong text-transparent hover:border-good hover:text-good",
                )}
              >
                <Check className="size-3" strokeWidth={3} />
              </StatusButton>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cn("text-sm font-semibold", done ? "text-muted line-through" : "text-ink")}>{t.title}</span>
                  {t.status === "in_progress" && (
                    <Pill tone="info" dot>
                      In progress
                    </Pill>
                  )}
                  {!done && t.priority !== "medium" && <Pill tone={PRIORITY_TONE[t.priority]}>{t.priority === "high" ? "High" : "Low"}</Pill>}
                </div>
                {t.detail && <p className="mt-0.5 text-xs text-muted">{t.detail}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {brandNames && (
                    <Link href={`/dashboard/${t.brandSlug}/tasks`} className="font-semibold text-ink-2 hover:text-brand-ink">
                      {brandNames[t.brandSlug] ?? t.brandSlug}
                    </Link>
                  )}
                  {ownerLabel(t) ? <span title={t.ownerEmail ?? t.ownerName ?? ""}>👤 {ownerLabel(t)}</span> : <span className="text-faint">Unassigned</span>}
                  {t.dueDate && (
                    <span className={cn(overdue && "font-bold text-bad", dueSoon && "font-bold text-warn-ink")}>
                      {overdue ? "Overdue · " : dueSoon ? "Due today · " : "Due "}
                      {shortDate(t.dueDate)}
                    </span>
                  )}
                  {t.source !== "manual" && <span className="text-faint">{t.source === "ai" ? "From meeting (AI)" : "From Claude"}</span>}
                  {showMeetingLink && t.meetingId && (
                    <Link href={`/dashboard/${t.brandSlug}/meetings/${t.meetingId}`} className="text-faint hover:text-brand-ink hover:underline">
                      View meeting
                    </Link>
                  )}
                  {done && t.completedAt && <span className="text-faint">Done {shortDate(t.completedAt.slice(0, 10))}</span>}
                </div>
                {done && t.completedNote && <p className="mt-1 text-xs text-good-ink">{t.completedNote}</p>}
                <details className="group/edit">
                  <summary className="mt-1 hidden w-fit cursor-pointer list-none text-[11px] font-semibold text-faint group-hover:inline-flex hover:text-brand-ink group-open/edit:inline-flex">
                    <Pencil className="mr-1 size-3" /> Edit
                  </summary>
                  <TaskEditForm task={t} team={Array.isArray(team) ? team : (team[t.brandSlug] ?? [])} />
                </details>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {t.status === "open" && (
                  <StatusButton task={t} to="in_progress" title="Start" className={smallBtn}>
                    <Play className="size-3" /> Start
                  </StatusButton>
                )}
                {t.status === "in_progress" && (
                  <StatusButton task={t} to="open" title="Pause" className={smallBtn}>
                    <Circle className="size-3" /> Not started
                  </StatusButton>
                )}
                {done && (
                  <StatusButton task={t} to="open" title="Reopen" className={smallBtn}>
                    <RotateCcw className="size-3" /> Reopen
                  </StatusButton>
                )}
                {(canDeleteAll || (me && t.createdBy?.toLowerCase() === me.toLowerCase())) && (
                <form action={deleteTask}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="brand" value={t.brandSlug} />
                  <PendingButton pendingText="" className="rounded-lg p-1.5 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-bad/10 hover:text-bad focus:opacity-100">
                    <Trash2 className="size-3.5" />
                    <span className="sr-only">Delete task</span>
                  </PendingButton>
                </form>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function taskCounts(tasks: Task[], today: string) {
  const open = tasks.filter((t) => t.status !== "done");
  return {
    open: open.length,
    inProgress: open.filter((t) => t.status === "in_progress").length,
    overdue: open.filter((t) => t.dueDate && t.dueDate < today).length,
    high: open.filter((t) => t.priority === "high").length,
  };
}

