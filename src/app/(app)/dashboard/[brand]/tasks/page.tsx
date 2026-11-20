import { Card, CardHeader, Kpi, PageHeader, Tabs } from "@/components/ui";
import { TaskForm } from "@/components/meeting-forms";
import { TaskList, taskCounts } from "@/components/task-list";
import { requireUser } from "@/lib/auth";
import { addDays } from "@/lib/dates";
import { meetingStore } from "@/lib/meetings/store";
import { brandClock, getBrandOr404, param, type BrandParams, type SearchParams } from "@/lib/page";

const VIEWS = [
  { key: "open", label: "Open" },
  { key: "mine", label: "Mine" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
] as const;

export default async function TasksPage({ params, searchParams }: { params: BrandParams; searchParams: SearchParams }) {
  const { brand: slug } = await params;
  const sp = await searchParams;
  const brand = await getBrandOr404(slug);
  const store = meetingStore();
  const [user, clock, all, team] = await Promise.all([requireUser(), brandClock(slug), store.listTasks({ brand: slug }), store.teamEmails()]);
  const view = VIEWS.some((v) => v.key === param(sp, "view")) ? param(sp, "view")! : "open";
  const me = user.email.toLowerCase();
  const pick = {
    open: all.filter((t) => t.status !== "done"),
    mine: all.filter((t) => t.status !== "done" && t.ownerEmail === me),
    done: all.filter((t) => t.status === "done"),
    all,
  } as const;
  const c = taskCounts(all, clock.today);
  const doneWeek = all.filter((t) => t.status === "done" && t.completedAt && t.completedAt.slice(0, 10) >= addDays(clock.today, -6)).length;

  return (
    <>
      <PageHeader eyebrow="Tasks" title="What's on our plate" subtitle={`${brand.name} · from meetings, Claude and the team`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi size="sm" label="Open" value={String(c.open)} sub={c.inProgress ? `${c.inProgress} in progress` : undefined} />
        <Kpi size="sm" label="Overdue" value={String(c.overdue)} />
        <Kpi size="sm" label="High priority" value={String(c.high)} />
        <Kpi size="sm" label="Done · 7 days" value={String(doneWeek)} />
      </div>

      <Card className="mt-6">
        <CardHeader title="Add a task" />
        <TaskForm brand={slug} team={team} me={user.email} />
      </Card>

      <Card className="mt-4">
        <Tabs
          items={VIEWS.map((v) => ({
            href: `/dashboard/${slug}/tasks?view=${v.key}`,
            label: v.label,
            active: view === v.key,
            count: pick[v.key].length,
          }))}
        />
        <TaskList
          tasks={pick[view as keyof typeof pick]}
          team={team}
          today={clock.today}
          empty={view === "mine" ? "Nothing assigned to you for this brand." : view === "done" ? "No finished tasks yet." : "No open tasks. Add one above or save a meeting."}
        />
      </Card>
    </>
  );
}
