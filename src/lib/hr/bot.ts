import "server-only";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { bearerMatches } from "@/lib/bearer";
import { LEAVE_LABELS, STATUS_LABELS, type LeaveRequest } from "@/lib/hr/policy";
import { checkRequest, personBalances, type HrCtx, type Person } from "@/lib/hr/service";

/*
 * Shared pieces of the HR bot API (/api/hr/bot/*). Authorization: Bearer <HR_API_TOKEN>.
 * The bot can read requests and attendance, approve requests that fit the policy and
 * escalate the rest to Zain. It can't decline, change settings or see app pages.
 */

export const NO_STORE = { "Cache-Control": "no-store" };

/** Null when the caller may proceed; otherwise the response to send. */
export async function botGuard(req: Request, target: string): Promise<NextResponse | null> {
  if (!process.env.HR_API_TOKEN) return NextResponse.json({ ok: false, error: "HR_API_TOKEN is not set on the server." }, { status: 503, headers: NO_STORE });
  if (!bearerMatches(req, "HR_API_TOKEN")) {
    await audit({ action: "hr.bot_denied", via: "webhook", target });
    return NextResponse.json({ ok: false, error: "Missing or wrong token. Send Authorization: Bearer <HR_API_TOKEN>." }, { status: 401, headers: NO_STORE });
  }
  return null;
}

export function serverError(what: string, e: unknown): NextResponse {
  console.error(`HR bot API: ${what} failed`, e);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500, headers: NO_STORE });
}

/** One request as the bot sees it: who, what, the policy check and the person's balances. */
export async function requestJson(ctx: HrCtx, r: LeaveRequest, p: Person | undefined) {
  const check = p ? await checkRequest(ctx, p, r) : { withinPolicy: false, problems: ["This person no longer has an account."], notes: [], days: r.days };
  const b = p ? await personBalances(ctx, p, r.startDate) : null;
  return {
    id: r.id,
    employee: p?.name ?? r.email,
    email: r.email,
    type: r.type,
    type_label: LEAVE_LABELS[r.type],
    start_date: r.startDate,
    end_date: r.endDate,
    session: r.session,
    days: r.days,
    reason: r.reason,
    status: r.status,
    status_label: STATUS_LABELS[r.status],
    requested_at: r.createdAt,
    decided_by: r.decidedBy,
    decided_at: r.decidedAt,
    decision_note: r.decisionNote,
    policy: { within_policy: check.withinPolicy, problems: check.problems, notes: check.notes },
    balances_now: b && {
      sick_left: b.sick.left,
      casual_left: b.casual.left,
      annual_left: b.annual.left,
      half_days_left: b.half_day.left,
      [`wfh_left_${b.month}`]: b.wfh.left,
    },
  };
}
