import Link from "next/link";
import { DataTable, type Column } from "@/components/data-table";
import { DAY_BADGES, NotReady, RequestList, attendanceRows, dayWord } from "@/components/hr-views";
import { Card, CardHeader, Kpi, PageHeader, Segmented, Tabs, cn, inputClass, buttonClass } from "@/components/ui";
import { requirePerm } from "@/lib/access";
import { data } from "@/lib/data";
import { addDays, daysInMonth } from "@/lib/dates";
import { hours, type PolicyCheck } from "@/lib/hr/policy";
import { attendance, checkRequest, hrContext, listPeople, namesOf, personBalances, summarize, type HrCtx, type Person } from "@/lib/hr/service";
import { HrNotReady } from "@/lib/hr/store";
import { param, type SearchParams } from "@/lib/page";

export const metadata = { title: "HR" };

const TABS = [
  { key: "today", label: "Day" },
  { key: "leave", label: "Leave requests" },
  { key: "month", label: "Month" },
  { key: "balances", label: "Balances" },
  { key: "time", label: "App time" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export default async function HrPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePerm("hr.manage");
  const sp = await searchParams;
  let ctx: HrCtx;
  try {
    ctx = await hrContext();
  } catch (e) {
    if (e instanceof HrNotReady) return (<><PageHeader eyebrow="HR" title="Team attendance & leave" /><NotReady /></>);
    throw e;
  }
  const tab: Tab = TABS.some((t) => t.key === param(sp, "tab")) ? (param(sp, "tab") as Tab) : "today";
  const people = await listPeople(ctx);
  const tracked = people.filter((p) => p.tracked);
  const waiting = await ctx.store.listRequests({ statuses: ["pending", "escalated"] });

  return (
    <>
      <PageHeader
        eyebrow="HR"
        title="Team attendance & leave"
        subtitle={`${tracked.length} people tracked · office hours ${ctx.policy.startTime}–${ctx.policy.endTime} (${ctx.policy.timezone})`}
        right={
          <Link href="/settings/hr" className={cn(buttonClass.secondary, buttonClass.small)}>
            HR settings
          </Link>
        }
      />
      <Card>
        <Tabs
          items={TABS.map((t) => ({
            href: `/hr?tab=${t.key}`,
            label: t.label,
            active: t.key === tab,
            count: t.key === "leave" ? waiting.length : undefined,
          }))}
        />
      </Card>
      <div className="mt-4">
        {tab === "today" && <DayTab ctx={ctx} people={tracked} date={YMD.test(param(sp, "date") ?? "") ? param(sp, "date")! : ctx.today} waiting={waiting.length} />}
        {tab === "leave" && <LeaveTab ctx={ctx} people={people} />}
        {tab === "month" && <MonthTab ctx={ctx} people={tracked} month={/^\d{4}-\d{2}$/.test(param(sp, "month") ?? "") ? param(sp, "month")! : ctx.today.slice(0, 7)} />}
        {tab === "balances" && <BalancesTab ctx={ctx} people={tracked} />}
        {tab === "time" && <TimeTab ctx={ctx} people={tracked} days={[7, 30, 90].includes(Number(param(sp, "days"))) ? Number(param(sp, "days")) : 7} />}
      </div>
    </>
  );
}

const DAY_COLUMNS: Column[] = [
  { key: "person", label: "Person" },
  { key: "status", label: "Status", badge: DAY_BADGES, badgeDot: true },
  { key: "leave", label: "Leave" },
  { key: "firstIn", label: "In", nowrap: true },
  { key: "lastOut", label: "Out", nowrap: true },
  { key: "span", label: "Hours in", nowrap: true },
  { key: "late", label: "Late", nowrap: true },
  { key: "app", label: "App time", sortKey: "appSeconds", nowrap: true },
  { key: "flags", label: "Needs a look" },
];

async function DayTab({ ctx, people, date, waiting }: { ctx: HrCtx; people: Person[]; date: string; waiting: number }) {
  const rows = await attendance(ctx, date, date, people);
  const n = (s: string) => rows.filter((r) => r.result.status === s).length;
  const holiday = ctx.holidays.find((h) => h.day === date);
  const noId = people.filter((p) => !p.deviceUserId);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/hr?tab=today&date=${addDays(date, -1)}`} className={cn(buttonClass.secondary, buttonClass.small)}>
          ← Previous day
        </Link>
        <form action="/hr" className="flex items-center gap-2">
          <input type="hidden" name="tab" value="today" />
          <input type="date" name="date" defaultValue={date} max={ctx.today} className={cn(inputClass, "h-8 w-40 text-xs")} />
          <button className={cn(buttonClass.ghost, buttonClass.small)}>Go</button>
        </form>
        {date < ctx.today && (
          <Link href={`/hr?tab=today&date=${addDays(date, 1)}`} className={cn(buttonClass.secondary, buttonClass.small)}>
            Next day →
          </Link>
        )}
        {date !== ctx.today && (
          <Link href="/hr?tab=today" className={cn(buttonClass.ghost, buttonClass.small)}>
            Today
          </Link>
        )}
        {holiday && <span className="text-sm font-semibold text-muted">Holiday: {holiday.name}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi size="sm" label="Office" value={String(n("office"))} />
        <Kpi size="sm" label="Working from home" value={String(n("wfh"))} />
        <Kpi size="sm" label="On leave" value={String(n("leave"))} />
        <Kpi size="sm" label={date === ctx.today ? "Not in yet" : "Absent"} value={String(date === ctx.today ? n("not_in_yet") : n("absent"))} />
        <Kpi size="sm" label="Late" value={String(rows.filter((r) => r.result.lateBy != null).length)} sub={`after ${ctx.policy.startTime} + ${ctx.policy.graceMinutes} min`} />
        <Kpi size="sm" label="Requests waiting" value={String(waiting)} sub={<Link href="/hr?tab=leave" className="font-semibold text-brand-ink hover:underline">Review →</Link>} />
      </div>
      {noId.length > 0 && (
        <p className="mt-3 rounded-lg bg-gold-100 px-3 py-2 text-xs font-semibold text-gold-800">
          No fingerprint machine ID yet for {noId.map((p) => p.name).join(", ")}: their office punches can&apos;t be matched. Add it in{" "}
          <Link href="/settings/hr" className="underline">
            Settings → HR
          </Link>
          .
        </p>
      )}
      <Card className="mt-4">
        <CardHeader title={date === ctx.today ? `Today · office time ${ctx.nowTime}` : date} />
        <DataTable columns={DAY_COLUMNS} rows={attendanceRows(rows, true)} defaultSort={{ key: "person", dir: "asc" }} pageSize={100} exportName={`attendance-${date}`} />
      </Card>
    </>
  );
}

async function LeaveTab({ ctx, people }: { ctx: HrCtx; people: Person[] }) {
  const names = namesOf(people);
  const byEmail = new Map(people.map((p) => [p.email, p]));
  const [waiting, recent] = await Promise.all([
    ctx.store.listRequests({ statuses: ["escalated", "pending"] }),
    ctx.store.listRequests({ statuses: ["approved", "declined", "cancelled"], from: addDays(ctx.today, -120), limit: 200 }),
  ]);
  const checks: Record<string, PolicyCheck> = {};
  for (const r of waiting) {
    const p = byEmail.get(r.email);
    if (p) checks[r.id] = await checkRequest(ctx, p, r);
  }
  const escalated = waiting.filter((r) => r.status === "escalated");
  const pending = waiting.filter((r) => r.status === "pending");
  const upcoming = recent.filter((r) => r.status === "approved" && r.endDate >= ctx.today).reverse();
  const history = recent.filter((r) => !upcoming.includes(r));
  return (
    <>
      <Card>
        <CardHeader title={`Waiting for you (${escalated.length})`} sub="HR sent these on: outside the policy, or HR wanted your call." />
        <RequestList requests={escalated} names={names} checks={checks} mode="admin" today={ctx.today} empty="Nothing waiting for you." />
      </Card>
      <Card className="mt-4">
        <CardHeader title={`Waiting for HR (${pending.length})`} sub="The HR bot approves these if they fit the policy, or sends them to you. You can decide now too." />
        <RequestList requests={pending} names={names} checks={checks} mode="admin" today={ctx.today} empty="No new requests." />
      </Card>
      <Card className="mt-4">
        <CardHeader title="Approved, coming up" />
        <RequestList requests={upcoming} names={names} mode="history" today={ctx.today} empty="No approved leave coming up." />
      </Card>
      <Card className="mt-4">
        <CardHeader title="History" sub="Last 4 months" />
        <RequestList requests={history} names={names} mode="history" today={ctx.today} empty="No decided requests yet." />
      </Card>
    </>
  );
}

const MONTH_COLUMNS: Column[] = [
  { key: "person", label: "Person" },
  { key: "office", label: "Office days", format: "int" },
  { key: "wfh", label: "WFH days", format: "int" },
  { key: "leave", label: "Leave days", format: "dec1" },
  { key: "absent", label: "Absent", format: "int" },
  { key: "late", label: "Late", format: "int" },
  { key: "avgIn", label: "Avg arrival", nowrap: true },
  { key: "avgSpan", label: "Avg hours in", sortKey: "avgMinutes", nowrap: true },
  { key: "app", label: "App time", sortKey: "appSeconds", nowrap: true },
  { key: "flags", label: "Flags", format: "int" },
];

async function MonthTab({ ctx, people, month }: { ctx: HrCtx; people: Person[]; month: string }) {
  const from = `${month}-01`;
  const end = `${month}-${String(daysInMonth(from)).padStart(2, "0")}`;
  const to = end < ctx.today ? end : ctx.today;
  const prev = addDays(from, -1).slice(0, 7);
  const next = addDays(end, 1).slice(0, 7);
  const rows = from <= ctx.today ? await attendance(ctx, from, to, people) : [];
  const sums = summarize(rows);
  const label = new Date(`${from}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <div className="mb-4">
        <Segmented
          items={[
            { href: `/hr?tab=month&month=${prev}`, label: "← Previous", active: false },
            { href: `/hr?tab=month&month=${month}`, label, active: true },
            ...(next <= ctx.today.slice(0, 7) ? [{ href: `/hr?tab=month&month=${next}`, label: "Next →", active: false }] : []),
          ]}
        />
      </div>
      <Card>
        <CardHeader title={`${label} · up to ${to}`} sub="Absent = a working day with no punch, no check-in and no approved leave." />
        <DataTable
          columns={MONTH_COLUMNS}
          rows={sums.map((s) => ({
            person: s.person.name,
            office: s.office,
            wfh: s.wfh,
            leave: s.leave,
            absent: s.absent,
            late: s.late,
            avgIn: s.avgIn ?? "",
            avgSpan: s.avgMinutes == null ? "" : hours(s.avgMinutes * 60),
            avgMinutes: s.avgMinutes ?? 0,
            app: hours(s.appSeconds),
            appSeconds: s.appSeconds,
            flags: s.flags,
          }))}
          defaultSort={{ key: "person", dir: "asc" }}
          pageSize={100}
          exportName={`attendance-${month}`}
          totals={{ label: "Total", sum: ["office", "wfh", "leave", "absent", "late", "flags"] }}
        />
      </Card>
      <Card className="mt-4">
        <CardHeader title="Every day" />
        <DataTable columns={[{ key: "day", label: "Day", sortKey: "date", nowrap: true }, ...DAY_COLUMNS]} rows={attendanceRows(rows, true)} defaultSort={{ key: "day", dir: "desc" }} pageSize={50} exportName={`attendance-days-${month}`} />
      </Card>
    </>
  );
}

const BALANCE_COLUMNS: Column[] = [
  { key: "person", label: "Person" },
  { key: "sick", label: "Sick left", format: "dec1" },
  { key: "casual", label: "Casual left", format: "dec1" },
  { key: "annual", label: "Annual left", format: "dec1" },
  { key: "half", label: "Half days left", format: "int" },
  { key: "total", label: "Total days left", format: "dec1" },
  { key: "wfh", label: "WFH used this month", format: "int" },
];

async function BalancesTab({ ctx, people }: { ctx: HrCtx; people: Person[] }) {
  const rows = await Promise.all(
    people.map(async (p) => {
      const b = await personBalances(ctx, p);
      return {
        person: p.name,
        sick: b.sick.left,
        casual: b.casual.left,
        annual: b.annual.left,
        half: b.half_day.left,
        total: b.sick.left + b.casual.left + b.annual.left + b.half_day.left * 0.5,
        wfh: b.wfh.used,
      };
    }),
  );
  const a = ctx.policy.allowance;
  return (
    <Card>
      <CardHeader
        title={`Leave balances · ${ctx.today.slice(0, 4)}`}
        sub={`Allowance: ${a.sick} sick · ${a.casual} casual · ${a.annual} annual · ${a.half_day} half days a year · ${a.wfh_per_month} WFH days a month. Leave taken before the app is set per person in Settings → HR.`}
      />
      <DataTable columns={BALANCE_COLUMNS} rows={rows} defaultSort={{ key: "person", dir: "asc" }} pageSize={100} exportName={`leave-balances-${ctx.today}`} />
    </Card>
  );
}

async function TimeTab({ ctx, people, days }: { ctx: HrCtx; people: Person[]; days: number }) {
  const from = addDays(ctx.today, -(days - 1));
  const [time, brands] = await Promise.all([ctx.store.appTime(from, ctx.today), data().listBrands()]);
  const brandName = new Map(brands.map((b) => [b.slug, b.name]));
  const emails = new Set(people.map((p) => p.email));
  const mine = time.filter((t) => emails.has(t.email));
  const slugs = [...new Set(mine.map((t) => t.brandSlug))].sort((x, y) => (x === "" ? 1 : y === "" ? -1 : x.localeCompare(y)));
  const label = (s: string) => (s === "" ? "Other pages" : (brandName.get(s) ?? s));
  const activeDays = (email: string) => new Set(mine.filter((t) => t.email === email).map((t) => t.day)).size;
  const rows = people.map((p) => {
    const row: Record<string, string | number> = { person: p.name };
    let total = 0;
    for (const s of slugs) {
      const sec = mine.filter((t) => t.email === p.email && t.brandSlug === s).reduce((x, t) => x + t.seconds, 0);
      row[`b_${s || "_"}`] = Math.round((sec / 3600) * 10) / 10;
      total += sec;
    }
    const d = activeDays(p.email);
    row.total = Math.round((total / 3600) * 10) / 10;
    row.days = d;
    row.perDay = d ? Math.round((total / 3600 / d) * 10) / 10 : 0;
    return row;
  });
  const columns: Column[] = [
    { key: "person", label: "Person" },
    { key: "total", label: "Total hours", format: "dec1" },
    { key: "days", label: "Days active", format: "int" },
    { key: "perDay", label: "Hours / active day", format: "dec1" },
    ...slugs.map((s) => ({ key: `b_${s || "_"}`, label: label(s), format: "dec1" as const })),
  ];
  return (
    <>
      <div className="mb-4">
        <Segmented items={[7, 30, 90].map((n) => ({ href: `/hr?tab=time&days=${n}`, label: `${n} days`, active: n === days }))} />
      </div>
      <Card>
        <CardHeader
          title={`Time active in AmzCentric OS · last ${dayWord(days)}`}
          sub={`Counted a minute at a time while the app is open and the person used the mouse or keyboard in the last ${ctx.policy.idleMinutes} minutes. Split by the brand they were looking at. Work outside the app (Seller Central, the Ads console, email) isn't counted.`}
        />
        <DataTable
          columns={columns}
          rows={rows}
          defaultSort={{ key: "total", dir: "desc" }}
          pageSize={100}
          exportName={`app-time-${from}-${ctx.today}`}
          totals={{ label: "Total", sum: ["total", "days", ...slugs.map((s) => `b_${s || "_"}`)] }}
        />
      </Card>
    </>
  );
}
