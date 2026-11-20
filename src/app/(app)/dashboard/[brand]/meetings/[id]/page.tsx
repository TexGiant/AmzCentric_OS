import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { deleteMeeting, reanalyzeMeeting } from "@/app/meeting-actions";
import { AutoRefresh, TaskForm } from "@/components/meeting-forms";
import { PendingButton } from "@/components/settings-forms";
import { TaskList } from "@/components/task-list";
import { Alert, Card, CardHeader, PageHeader, Pill, buttonClass, cn } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { shortDate } from "@/lib/dates";
import { analysisEnabled } from "@/lib/meetings/analyze";
import { meetingStore } from "@/lib/meetings/store";
import { INSIGHT_META, SOURCE_LABEL, STATUS_META } from "@/lib/meetings/ui";
import { brandClock, getBrandOr404 } from "@/lib/page";

export const maxDuration = 300;

export default async function MeetingPage({ params }: { params: Promise<{ brand: string; id: string }> }) {
  const { brand: slug, id } = await params;
  const brand = await getBrandOr404(slug);
  const store = meetingStore();
  const [user, meeting, clock, team] = await Promise.all([requireUser(), store.getMeeting(id), brandClock(slug), store.teamEmails()]);
  if (!meeting || meeting.brandSlug !== slug) notFound();
  const tasks = await store.listTasks({ meetingId: id });
  // Tasks this meeting closed (they belong to earlier meetings).
  const closedHere = (await store.listTasks({ brand: slug, status: ["done"] })).filter(
    (t) => t.meetingId !== id && t.completedNote?.includes(`${shortDate(meeting.meetingDate)} meeting`),
  );
  const working = meeting.status === "pending" || meeting.status === "processing";
  const st = STATUS_META[meeting.status];

  return (
    <>
      <AutoRefresh active={working} />
      <Link href={`/dashboard/${slug}/meetings`} className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-brand-ink">
        <ArrowLeft className="size-3.5" /> All meetings
      </Link>
      <PageHeader
        eyebrow={`Meeting · ${shortDate(meeting.meetingDate)}, ${meeting.meetingDate.slice(0, 4)}`}
        title={meeting.title}
        subtitle={`${brand.name} · ${SOURCE_LABEL[meeting.source]}${meeting.createdBy ? ` by ${meeting.createdBy}` : ""}`}
        right={
          <div className="flex items-center gap-2">
            <Pill tone={st.tone} dot={working}>
              {st.label}
            </Pill>
            {!working && (
              <form action={reanalyzeMeeting}>
                <input type="hidden" name="id" value={meeting.id} />
                <input type="hidden" name="brand" value={slug} />
                <PendingButton pendingText="Starting…" className={cn(buttonClass.secondary, buttonClass.small)}>
                  <RefreshCw className="size-3.5" /> {meeting.status === "done" ? "Re-analyze" : "Analyze"}
                </PendingButton>
              </form>
            )}
            <form action={deleteMeeting}>
              <input type="hidden" name="id" value={meeting.id} />
              <input type="hidden" name="brand" value={slug} />
              <PendingButton pendingText="Deleting…" className={buttonClass.danger}>
                <Trash2 className="size-3.5" /> Delete
              </PendingButton>
            </form>
          </div>
        }
      />

      {working && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-info/35 bg-info/10 px-5 py-4 text-sm text-ink">
          <Loader2 className="size-4 animate-spin text-info" />
          Claude is reading the notes alongside {brand.name}&apos;s numbers. This usually takes under a minute; the page updates on its own.
        </div>
      )}
      {meeting.status === "failed" && (
        <div className="mb-4">
          <Alert tone="bad" title="Analysis failed">
            {meeting.error} The notes are saved — press Analyze to try again.
          </Alert>
        </div>
      )}
      {meeting.status === "skipped" && (
        <div className="mb-4">
          <Alert tone="warn" title="Notes saved without insights">
            {meeting.error ?? "Automatic analysis is off."}
            {!analysisEnabled() && " You can still add tasks by hand below."}
          </Alert>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {meeting.summary && (
            <Card>
              <CardHeader title="Summary" />
              <p className="px-6 py-5 text-[15px] leading-relaxed text-ink-2">{meeting.summary}</p>
            </Card>
          )}

          {meeting.insights.length > 0 && (
            <Card>
              <CardHeader title="Insights" sub={`${meeting.insights.length} from this meeting`} />
              <div className="grid gap-3 p-6 md:grid-cols-2">
                {meeting.insights.map((ins, i) => {
                  const meta = INSIGHT_META[ins.type] ?? INSIGHT_META.decision;
                  return (
                    <div key={i} className="rounded-xl border border-line p-4">
                      <Pill tone={meta.tone}>{meta.label}</Pill>
                      <div className="mt-2 text-sm font-bold text-ink">{ins.title}</div>
                      {ins.detail && <p className="mt-1 text-xs leading-relaxed text-muted">{ins.detail}</p>}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Tasks" sub={tasks.length ? `${tasks.filter((t) => t.status !== "done").length} open of ${tasks.length}` : undefined} />
            <TaskList tasks={tasks} team={team} today={clock.today} showMeetingLink={false} empty={working ? "Tasks will appear here when the analysis finishes." : "No tasks from this meeting."} />
            <div className="border-t border-line">
              <TaskForm brand={slug} team={team} meetingId={meeting.id} me={user.email} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {meeting.agenda.length > 0 && (
            <Card>
              <CardHeader title="Check at the next meeting" />
              <ul className="list-disc space-y-2 py-5 pr-6 pl-10 text-sm text-ink-2">
                {meeting.agenda.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </Card>
          )}
          {closedHere.length > 0 && (
            <Card>
              <CardHeader title="Closed by this meeting" sub="Earlier tasks the notes said were done" />
              <TaskList tasks={closedHere} team={team} today={clock.today} />
            </Card>
          )}
          <Card>
            <CardHeader title="Notes" sub={`${meeting.notes.length.toLocaleString()} characters`} />
            <details className="group">
              <summary className="cursor-pointer list-none px-6 py-3 text-xs font-semibold text-brand-ink hover:underline">
                <span className="group-open:hidden">Show the full notes</span>
                <span className="hidden group-open:inline">Hide notes</span>
              </summary>
              <pre className="max-h-[640px] overflow-auto px-6 pb-6 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{meeting.notes}</pre>
            </details>
          </Card>
        </div>
      </div>
    </>
  );
}
