import { CalendarCheck } from "lucide-react";
import { DataTable, type Column } from "@/components/data-table";
import { LeaveRequestForm } from "@/components/hr-forms";
import { BalanceTable, DAY_BADGES, NotReady, RequestList, attendanceRows } from "@/components/hr-views";
import { Card, CardHeader, Empty, Kpi, PageHeader } from "@/components/ui";
import { requirePerm } from "@/lib/access";
import { addDays } from "@/lib/dates";
import { DAY_LABELS, hours } from "@/lib/hr/policy";
import { attendance, findPerson, hrContext, personBalances } from "@/lib/hr/service";
import { HrNotReady } from "@/lib/hr/store";

export const metadata = { title: "My day" };

const COLUMNS: Column[] = [
  { key: "day", label: "Day", sortKey: "date", nowrap: true },
  { key: "status", label: "Status", badge: DAY_BADGES, badgeDot: true },
  { key: "leave", label: "Leave" },
  { key: "firstIn", label: "In", nowrap: true },
  { key: "lastOut", label: "Out", nowrap: true },
  { key: "span", label: "Hours in", nowrap: true },
  { key: "late", label: "Late", nowrap: true },
  { key: "app", label: "App time", sortKey: "appSeconds", nowrap: true },
  { key: "flags", label: "Notes" },
];

export default async function MyDayPage() {
  const a = await requirePerm("hr.self");
  let ctx;
  try {
    ctx = await hrContext();
  } catch (e) {
    if (e instanceof HrNotReady) return (<><PageHeader eyebrow="My day" title="My day" /><NotReady /></>);
    throw e;
  }
  const p = await findPerson(ctx, a.email);
  if (!p) return <PageHeader eyebrow="My day" title="My day" subtitle="Your account isn't set up for HR yet. Ask an admin." />;

  const from = addDays(ctx.today, -27);
  const weekFrom = addDays(ctx.today, -6);
  const monthFrom = `${ctx.today.slice(0, 7)}-01`;
  const [rows, b, requests] = await Promise.all([
    attendance(ctx, from < monthFrom ? from : monthFrom, ctx.today, [p]),
    personBalances(ctx, p),
    ctx.store.listRequests({ email: p.email, limit: 50 }),
  ]);
  const today = rows.find((r) => r.day === ctx.today)!;
  const sum = (since: string) => rows.filter((r) => r.day >= since).reduce((s, r) => s + r.appSeconds, 0);
  const upcoming = requests.filter((r) => r.endDate >= ctx.today || r.status === "pending" || r.status === "escalated");
  const past = requests.filter((r) => !upcoming.includes(r));

  return (
    <>
      <PageHeader
        eyebrow="My day"
        title={`Hi ${p.name.split(" ")[0]}`}
        subtitle={`${new Date(`${ctx.today}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} · office hours ${ctx.policy.startTime}–${ctx.policy.endTime}`}
      />
      {!p.tracked && (
        <p className="mb-4 rounded-lg bg-surface px-3 py-2 text-xs text-muted ring-1 ring-line">Attendance and app time aren&apos;t tracked for you. You can still request leave here.</p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          size="sm"
          label="Today"
          value={DAY_LABELS[today.result.status]}
          sub={today.result.firstIn ? `In ${today.result.firstIn}${today.result.lastOut ? ` · out ${today.result.lastOut}` : ""}${today.result.lateBy ? ` · ${today.result.lateBy} min late` : ""}` : "No punch or check-in yet"}
        />
        <Kpi size="sm" label="App time today" value={hours(today.appSeconds)} sub={`This week ${hours(sum(weekFrom))} · this month ${hours(sum(monthFrom))}`} />
        <Kpi size="sm" label="Annual leave left" value={String(b.annual.left)} sub={`of ${b.annual.allowed} in ${b.year} · casual ${b.casual.left} · sick ${b.sick.left}`} />
        <Kpi size="sm" label="WFH days left" value={String(b.wfh.left)} sub={`of ${b.wfh.allowed} this month (resets on the 1st)`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Card>
          <CardHeader title="Request leave or WFH" sub="Sick: same day is fine. Casual: 1 day's notice. Annual: 3 days' notice." />
          <LeaveRequestForm today={ctx.today} wfhLeft={b.wfh.left} />
        </Card>
        <Card>
          <CardHeader title="Leave balance" />
          <BalanceTable b={b} />
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="My requests" sub="Upcoming and waiting" />
        <RequestList requests={upcoming} mode="mine" today={ctx.today} empty="No upcoming leave." />
        {past.length > 0 && (
          <details className="border-t border-line">
            <summary className="cursor-pointer px-6 py-3 text-sm font-semibold text-muted hover:text-ink">Past requests ({past.length})</summary>
            <RequestList requests={past} mode="history" today={ctx.today} empty="" />
          </details>
        )}
      </Card>

      {p.tracked && (
        <Card className="mt-4">
          <CardHeader title="My attendance" sub="Last 4 weeks. Office days come from the fingerprint machine; WFH from your check-in. App time counts minutes you're active in AmzCentric OS." />
          {rows.length ? (
            <DataTable columns={COLUMNS} rows={attendanceRows(rows.filter((r) => r.day >= from).reverse(), false)} defaultSort={{ key: "day", dir: "desc" }} pageSize={31} exportName={`my-attendance-${ctx.today}`} />
          ) : (
            <Empty icon={<CalendarCheck />} title="Nothing yet" />
          )}
        </Card>
      )}
    </>
  );
}
