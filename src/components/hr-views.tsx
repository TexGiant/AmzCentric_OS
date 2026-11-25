import { cancelRequestAction } from "@/app/hr-actions";
import { DecisionForm } from "@/components/hr-forms";
import { PendingButton } from "@/components/settings-forms";
import { Alert, Pill, buttonClass, type Tone } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { DAY_LABELS, LEAVE_LABELS, STATUS_LABELS, hours, type Balances, type DayStatus, type LeaveRequest, type PolicyCheck, type RequestStatus } from "@/lib/hr/policy";
import type { DayRow } from "@/lib/hr/service";

/* Server-rendered pieces shared by My day, the HR page and Settings → HR. */

export const DAY_TONE: Record<DayStatus, Tone> = {
  office: "good",
  wfh: "info",
  leave: "brand",
  holiday: "neutral",
  weekend: "neutral",
  absent: "bad",
  not_in_yet: "warn",
};
/** DataTable badge map: label → tone. */
export const DAY_BADGES: Record<string, string> = Object.fromEntries(Object.entries(DAY_LABELS).map(([k, v]) => [v, DAY_TONE[k as DayStatus]]));

export const STATUS_TONE: Record<RequestStatus, Tone> = { pending: "warn", escalated: "brand", approved: "good", declined: "bad", cancelled: "neutral" };

export function dates(r: Pick<LeaveRequest, "startDate" | "endDate" | "session" | "type">): string {
  const s = shortDate(r.startDate);
  if (r.type === "half_day") return `${s} · ${r.session.toUpperCase()}`;
  return r.endDate === r.startDate ? s : `${s} → ${shortDate(r.endDate)}`;
}

export function dayWord(n: number) {
  return `${n} day${n === 1 ? "" : "s"}`;
}

/** Attendance rows for a DataTable. */
export function attendanceRows(rows: DayRow[], withPerson: boolean) {
  return rows.map((r) => ({
    day: shortDate(r.day),
    date: r.day,
    ...(withPerson ? { person: r.person.name } : {}),
    status: DAY_LABELS[r.result.status],
    leave: r.result.leave ? `${LEAVE_LABELS[r.result.leave.type]}${r.result.leave.session !== "full" ? ` ${r.result.leave.session.toUpperCase()}` : ""}` : "",
    firstIn: r.result.firstIn ?? "",
    lastOut: r.result.lastOut ?? "",
    span: r.result.minutes == null ? "" : hours(r.result.minutes * 60),
    late: r.result.lateBy == null ? "" : `${r.result.lateBy} min`,
    app: hours(r.appSeconds),
    appSeconds: r.appSeconds,
    flags: r.result.flags.join(" · "),
  }));
}

export function BalanceTable({ b }: { b: Balances }) {
  const rows: Array<[string, { allowed: number; used: number; left: number }, string]> = [
    ["Sick", b.sick, `days in ${b.year}`],
    ["Casual", b.casual, `days in ${b.year}`],
    ["Annual", b.annual, `days in ${b.year}`],
    ["Half days", b.half_day, `in ${b.year}`],
    ["Work from home", b.wfh, "days this month"],
  ];
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs font-bold text-muted">
          <th className="px-6 py-2.5">Type</th>
          <th className="px-3 py-2.5 text-right">Allowed</th>
          <th className="px-3 py-2.5 text-right">Used</th>
          <th className="px-6 py-2.5 text-right">Left</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map(([label, v, unit]) => (
          <tr key={label}>
            <td className="px-6 py-2.5 font-semibold text-ink">
              {label} <span className="text-xs font-normal text-faint">{unit}</span>
            </td>
            <td className="px-3 py-2.5 text-right tabular">{v.allowed}</td>
            <td className="px-3 py-2.5 text-right tabular">{v.used}</td>
            <td className="px-6 py-2.5 text-right font-bold tabular">
              <span className={v.left === 0 ? "text-bad" : "text-ink"}>{v.left}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A list of requests. `mine`: the person's own (cancel while waiting); `admin`: decide. */
export function RequestList({
  requests,
  names,
  checks,
  mode,
  today,
  empty,
}: {
  requests: LeaveRequest[];
  names?: Record<string, string>;
  checks?: Record<string, PolicyCheck>;
  mode: "mine" | "admin" | "history";
  today: string;
  empty: string;
}) {
  if (!requests.length) return <p className="px-6 py-8 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {requests.map((r) => {
        const waiting = r.status === "pending" || r.status === "escalated";
        const check = checks?.[r.id];
        return (
          <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-6 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {names && <span className="text-sm font-bold text-ink">{names[r.email] ?? r.email}</span>}
                <span className="text-sm font-semibold text-ink">{LEAVE_LABELS[r.type]}</span>
                <span className="text-sm text-ink-2">{dates(r)}</span>
                <span className="text-xs text-muted">{r.type === "half_day" ? "½ day" : dayWord(r.days)}</span>
                <Pill tone={STATUS_TONE[r.status]} dot>
                  {STATUS_LABELS[r.status]}
                </Pill>
              </div>
              {r.reason && <p className="mt-1 text-sm text-ink-2">“{r.reason}”</p>}
              {check && waiting && (
                <div className="mt-2 text-xs">
                  {check.withinPolicy ? (
                    <span className="font-semibold text-good">Within policy</span>
                  ) : (
                    <ul className="space-y-0.5 font-semibold text-bad">
                      {check.problems.map((p) => (
                        <li key={p}>• {p}</li>
                      ))}
                    </ul>
                  )}
                  {check.notes.map((n) => (
                    <div key={n} className="text-warn-ink">
                      {n}
                    </div>
                  ))}
                </div>
              )}
              {(r.decisionNote || r.decidedBy) && (
                <p className="mt-1 text-xs text-muted">
                  {[r.decidedBy && (r.decidedBy === "hr-bot" ? "HR" : (names?.[r.decidedBy] ?? r.decidedBy)), r.decisionNote].filter(Boolean).join(": ")}
                </p>
              )}
            </div>
            {mode === "mine" && waiting && (
              <form action={cancelRequestAction}>
                <input type="hidden" name="id" value={r.id} />
                <PendingButton pendingText="Cancelling…" className={buttonClass.danger}>
                  Cancel
                </PendingButton>
              </form>
            )}
            {mode === "admin" && waiting && <DecisionForm id={r.id} />}
            {mode === "history" && r.status === "approved" && r.endDate >= today && <DecisionForm id={r.id} canCancel />}
          </li>
        );
      })}
    </ul>
  );
}

export function NotReady() {
  return (
    <Alert tone="warn" title="HR isn't set up yet">
      Run <code>supabase/migrations/0009_hr.sql</code> in the Supabase SQL editor, then reload this page.
    </Alert>
  );
}
