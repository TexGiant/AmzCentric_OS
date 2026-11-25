import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { daysInMonth } from "@/lib/dates";
import { NO_STORE, botGuard, serverError } from "@/lib/hr/bot";
import { hours } from "@/lib/hr/policy";
import { attendance, hrContext, listPeople, personBalances, summarize } from "@/lib/hr/service";

/*
 * GET /api/hr/bot/month?month=YYYY-MM — per person for the month (default this month, up to
 * today): office days, WFH days, leave, absences, late arrivals, average arrival, time in the
 * app, and leave balances. For the monthly HR report to Zain.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await botGuard(req, "month");
  if (denied) return denied;
  const raw = new URL(req.url).searchParams.get("month");
  if (raw && !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return NextResponse.json({ ok: false, error: "month must be YYYY-MM" }, { status: 400, headers: NO_STORE });
  try {
    const ctx = await hrContext();
    const month = raw ?? ctx.today.slice(0, 7);
    const from = `${month}-01`;
    if (from > ctx.today) return NextResponse.json({ ok: false, error: "That month hasn't started." }, { status: 400, headers: NO_STORE });
    const end = `${month}-${String(daysInMonth(from)).padStart(2, "0")}`;
    const to = end < ctx.today ? end : ctx.today;
    const people = (await listPeople(ctx)).filter((p) => p.tracked);
    const rows = await attendance(ctx, from, to, people);
    const sums = summarize(rows);
    const out = await Promise.all(
      sums.map(async (s) => {
        const b = await personBalances(ctx, s.person, from);
        return {
          employee: s.person.name,
          email: s.person.email,
          office_days: s.office,
          wfh_days: s.wfh,
          leave_days: s.leave,
          absent_days: s.absent,
          late_days: s.late,
          average_arrival: s.avgIn,
          average_hours_in: s.avgMinutes == null ? null : hours(s.avgMinutes * 60),
          app_time: hours(s.appSeconds),
          app_hours: Math.round((s.appSeconds / 3600) * 10) / 10,
          flags: s.flags,
          balances: {
            sick: b.sick,
            casual: b.casual,
            annual: b.annual,
            half_days: b.half_day,
            wfh_this_month: b.wfh,
          },
        };
      }),
    );
    await audit({ action: "hr.bot_month", via: "webhook", target: month });
    return NextResponse.json({ ok: true, month, from, to, through_today: to === ctx.today, people: out }, { headers: NO_STORE });
  } catch (e) {
    return serverError("month", e);
  }
}
