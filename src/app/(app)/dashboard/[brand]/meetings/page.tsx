import Link from "next/link";
import { Bot, ChevronRight, FileText, Webhook } from "lucide-react";
import { Card, CardHeader, Empty, IconChip, Kpi, PageHeader, Pill } from "@/components/ui";
import { MeetingForm } from "@/components/meeting-forms";
import { shortDate } from "@/lib/dates";
import { analysisEnabled } from "@/lib/meetings/analyze";
import { meetingStore } from "@/lib/meetings/store";
import { can, visibleTasks } from "@/lib/rbac";
import { SOURCE_LABEL, STATUS_META } from "@/lib/meetings/ui";
import { brandClock, getBrandOr404, type BrandParams } from "@/lib/page";

// Claude's analysis runs after the form returns, inside this route's time limit.
export const maxDuration = 300;

export default async function MeetingsPage({ params }: { params: BrandParams }) {
  const { brand: slug } = await params;
  const brand = await getBrandOr404(slug, "meetings.view");
  const a = brand.access;
  const canEdit = can(a, "meetings.edit", slug);
  const store = meetingStore({ asUser: true });
  const [clock, meetings, tasks] = await Promise.all([
    brandClock(slug),
    store.listMeetings(slug, 100),
    store.listTasks({ brand: slug }).then((t) => visibleTasks(a, t)),
  ]);
  const aiEnabled = analysisEnabled();
  const byMeeting = new Map<string, { total: number; open: number }>();
  for (const t of tasks) {
    if (!t.meetingId) continue;
    const c = byMeeting.get(t.meetingId) ?? { total: 0, open: 0 };
    c.total++;
    if (t.status !== "done") c.open++;
    byMeeting.set(t.meetingId, c);
  }
  const fromMeetings = tasks.filter((t) => t.meetingId);
  const openFromMeetings = fromMeetings.filter((t) => t.status !== "done");

  return (
    <>
      <PageHeader
        eyebrow="Meetings"
        title="Weekly brand meetings"
        subtitle={`${brand.name} · paste the notes, get a summary, insights and tasks`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi size="sm" label="Meetings" value={String(meetings.length)} sub={meetings[0] ? `Last: ${shortDate(meetings[0].meetingDate)}` : undefined} />
        <Kpi size="sm" label="Tasks from meetings" value={String(fromMeetings.length)} />
        <Kpi size="sm" label="Still open" value={String(openFromMeetings.length)} />
        <Kpi
          size="sm"
          label="Overdue"
          value={String(openFromMeetings.filter((t) => t.dueDate && t.dueDate < clock.today).length)}
        />
      </div>

      {canEdit && (
      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Add meeting notes" sub="Claude reads the notes alongside this brand's live numbers and open tasks." />
          <MeetingForm brand={slug} today={clock.today} aiEnabled={aiEnabled} />
        </Card>

        <Card>
          <CardHeader title="Capture automatically" />
          <div className="space-y-5 p-6 text-sm">
            <div className="flex gap-3">
              <IconChip>
                <Bot className="size-4" strokeWidth={1.75} />
              </IconChip>
              <div>
                <div className="font-bold text-ink">From Claude</div>
                <p className="mt-1 text-muted">
                  After Claude records the call, say: <span className="font-semibold text-ink-2">“Save this meeting to AmzCentric OS for {brand.name}.”</span>{" "}
                  The notes, insights and tasks land here.
                </p>
                <Link href="/settings/claude" className="mt-1 inline-block text-xs font-semibold text-brand-ink hover:underline">
                  Connector setup →
                </Link>
              </div>
            </div>
            <div className="flex gap-3">
              <IconChip tone="info">
                <Webhook className="size-4" strokeWidth={1.75} />
              </IconChip>
              <div>
                <div className="font-bold text-ink">From a recorder</div>
                <p className="mt-1 text-muted">Fireflies, Otter, Fathom or Google Meet notes can be pushed in by Zapier with no copy-paste.</p>
                {a.roles.includes("admin") && (
                  <Link href="/settings/meetings" className="mt-1 inline-block text-xs font-semibold text-brand-ink hover:underline">
                    Webhook setup →
                  </Link>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>
      )}

      <Card className="mt-4">
        <CardHeader title="History" />
        {meetings.length === 0 ? (
          <Empty icon={<FileText className="size-6" strokeWidth={1.5} />} title="No meetings yet">
            Paste this week&apos;s notes above. Each meeting gets a summary, insights tied to the brand&apos;s numbers, and tasks with owners and due dates.
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {meetings.map((m) => {
              const st = STATUS_META[m.status];
              const counts = byMeeting.get(m.id);
              return (
                <li key={m.id}>
                  <Link href={`/dashboard/${slug}/meetings/${m.id}`} className="group flex items-start gap-4 px-6 py-4 hover:bg-canvas">
                    <div className="w-14 shrink-0 text-center">
                      <div className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase">
                        {new Date(`${m.meetingDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}
                      </div>
                      <div className="font-display text-[22px] leading-none font-bold text-ink">{Number(m.meetingDate.slice(8, 10))}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-ink">{m.title}</span>
                        <Pill tone={st.tone} dot={m.status === "processing"}>
                          {st.label}
                        </Pill>
                        <span className="text-xs text-faint">{SOURCE_LABEL[m.source]}</span>
                      </div>
                      {m.summary && <p className="mt-1 line-clamp-2 text-sm text-muted">{m.summary}</p>}
                      <div className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-muted">
                        {m.insights.length > 0 && <span>{m.insights.length} insights</span>}
                        {counts && (
                          <span>
                            {counts.total} tasks · {counts.open} open
                          </span>
                        )}
                        {m.createdBy && <span>by {m.createdBy.split("@")[0]}</span>}
                      </div>
                    </div>
                    <ChevronRight className="mt-2 size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand-ink" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
