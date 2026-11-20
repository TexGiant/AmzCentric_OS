import { Card, Kpi, PageHeader, Tabs } from "@/components/ui";
import { TaskList, taskCounts } from "@/components/task-list";
import { requireUser } from "@/lib/auth";
import { data } from "@/lib/data";
import { todayInTz } from "@/lib/dates";
import { meetingStore } from "@/lib/meetings/store";
import { param, type SearchParams } from "@/lib/page";

const VIEWS = [
  { key: "mine", label: "Mine" },
  { key: "overdue", label: "Overdue" },
  { key: "open", label: "All open" },
  { key: "unassigned", label: "Unassigned" },
] as const;

export default async function MyTasksPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const store = meetingStore();
  const [user, brands, open, team] = await Promise.all([
    requireUser(),
    data().listBrands(),
    store.listTasks({ status: ["open", "in_progress"] }),
    store.teamEmails(),
  ]);
  const today = todayInTz("America/Los_Angeles");
  const me = user.email.toLowerCase();
  const view = VIEWS.some((v) => v.key === param(sp, "view")) ? param(sp, "view")! : "mine";
  const pick = {
    mine: open.filter((t) => t.ownerEmail === me),
    overdue: open.filter((t) => t.dueDate && t.dueDate < today),
    open,
    unassigned: open.filter((t) => !t.ownerEmail && !t.ownerName),
  } as const;
  const mine = taskCounts(pick.mine, today);
  const brandNames = Object.fromEntries(brands.map((b) => [b.slug, b.name]));

  return (
    <>
      <PageHeader eyebrow="Tasks" title="My tasks" subtitle="Every brand, in one list" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi size="sm" label="Assigned to me" value={String(mine.open)} />
        <Kpi size="sm" label="My overdue" value={String(mine.overdue)} />
        <Kpi size="sm" label="Team open" value={String(open.length)} />
        <Kpi size="sm" label="Team overdue" value={String(pick.overdue.length)} />
      </div>
      <Card className="mt-6">
        <Tabs items={VIEWS.map((v) => ({ href: `/tasks?view=${v.key}`, label: v.label, active: view === v.key, count: pick[v.key].length }))} />
        <TaskList
          tasks={pick[view as keyof typeof pick]}
          team={team}
          today={today}
          brandNames={brandNames}
          empty={view === "mine" ? "Nothing assigned to you. Nice." : "Nothing here."}
        />
      </Card>
    </>
  );
}
