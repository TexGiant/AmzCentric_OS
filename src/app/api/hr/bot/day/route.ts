import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { addDays } from "@/lib/dates";
import { NO_STORE, botGuard, serverError } from "@/lib/hr/bot";
import { DAY_LABELS, LEAVE_LABELS, hours } from "@/lib/hr/policy";
import { attendance, hrContext } from "@/lib/hr/service";

/*
 * GET /api/hr/bot/day?date=YYYY-MM-DD — the attendance board for one day (default today,
 * office time): who is in the office, working from home, on leave, late or absent, their
 * first in / last out, time active in the app, and anything that needs a look (flags).
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await botGuard(req, "day");
  if (denied) return denied;
  const raw = new URL(req.url).searchParams.get("date");
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return NextResponse.json({ ok: false, error: "date must be YYYY-MM-DD" }, { status: 400, headers: NO_STORE });
  try {
    const ctx = await hrContext();
    const date = raw ?? ctx.today;
    if (date > addDays(ctx.today, 31)) return NextResponse.json({ ok: false, error: "date is too far ahead" }, { status: 400, headers: NO_STORE });
    const [rows, waiting] = await Promise.all([attendance(ctx, date, date), ctx.store.listRequests({ statuses: ["pending", "escalated"] })]);
    const people = rows.map((r) => ({
      employee: r.person.name,
      email: r.person.email,
      status: r.result.status,
      status_label: DAY_LABELS[r.result.status],
      first_in: r.result.firstIn,
      last_out: r.result.lastOut,
      hours_in: r.result.minutes == null ? null : hours(r.result.minutes * 60),
      late_by_minutes: r.result.lateBy,
      leave: r.result.leave ? `${LEAVE_LABELS[r.result.leave.type]}${r.result.leave.session !== "full" ? ` (${r.result.leave.session.toUpperCase()})` : ""}` : null,
      app_time: hours(r.appSeconds),
      app_minutes: Math.round(r.appSeconds / 60),
      flags: r.result.flags,
      no_machine_id: !r.person.deviceUserId,
    }));
    const count = (s: string) => people.filter((p) => p.status === s).length;
    await audit({ action: "hr.bot_day", via: "webhook", target: date });
    return NextResponse.json(
      {
        ok: true,
        date,
        is_today: date === ctx.today,
        office_time_now: date === ctx.today ? ctx.nowTime : null,
        office_hours: `${ctx.policy.startTime}–${ctx.policy.endTime} (late after ${ctx.policy.graceMinutes} min)`,
        holiday: ctx.holidays.find((h) => h.day === date)?.name ?? null,
        totals: { office: count("office"), wfh: count("wfh"), on_leave: count("leave"), absent: count("absent"), not_in_yet: count("not_in_yet"), late: people.filter((p) => p.late_by_minutes != null).length },
        requests_waiting: { pending: waiting.filter((r) => r.status === "pending").length, escalated_to_zain: waiting.filter((r) => r.status === "escalated").length },
        people,
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    return serverError("day", e);
  }
}
