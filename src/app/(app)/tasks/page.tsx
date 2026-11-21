import { Card, Kpi, PageHeader, Tabs } from "@/components/ui";
import { TaskList, taskCounts } from "@/components/task-list";
import { requireAccess } from "@/lib/access";
import { data } from "@/lib/data";
import { todayInTz } from "@/lib/dates";
import { meetingStore } from "@/lib/meetings/store";
import { assignableEmails, canSeeBrand, taskScope, visibleTasks } from "@/lib/rbac";
import { param, type SearchParams } from "@/lib/page";

const VIEWS = [
  { key: "mine", label: "Mine" },
  { key: "overdue", label: "Overdue" },
  { key: "open", label: "All open" },
  { key: "unassigned", label: "Unassigned" },
] as const;

export default async function MyTasksPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const a = await requireAccess();
  const [brands, rows] = await Promise.all([data().listBrands(), meetingStore({ asUser: true }).listTasks({ status: ["open", "in_progress"] })]);
  // Only brands this person sees, and only tasks their role lets them see.
  const open = visibleTasks(a, rows).filter((t) => canSeeBrand(a, t.brandSlug));
  const members = await Promise.all(brands.map(async (b) => [b.slug, assignableEmails(a, await meetingStore().brandMembers(b.slug))] as const));
  const team = Object.fromEntries(members);
  const today = todayInTz("America/Los_Angeles");
  const me = a.email;
  const teamWord = taskScope(a) === "all" ? "Team" : "My";
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
        <Kpi size="sm" label={`${teamWord} open`} value={String(open.length)} />
        <Kpi size="sm" label={`${teamWord} overdue`} value={String(pick.overdue.length)} />
      </div>
      <Card className="mt-6">
        <Tabs items={VIEWS.map((v) => ({ href: `/tasks?view=${v.key}`, label: v.label, active: view === v.key, count: pick[v.key].length }))} />
        <TaskList
          tasks={pick[view as keyof typeof pick]}
          team={team}
          me={a.email}
          canDeleteAll={taskScope(a) === "all"}
          today={today}
          brandNames={brandNames}
          empty={view === "mine" ? "Nothing assigned to you. Nice." : "Nothing here."}
        />
      </Card>
    </>
  );
}
