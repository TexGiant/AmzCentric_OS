"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  addHolidayAction,
  decideAction,
  requestLeaveAction,
  savePersonAction,
  savePolicyAction,
  uploadPunchesAction,
  type FormState,
} from "@/app/hr-actions";
import { PendingButton } from "@/components/settings-forms";
import { buttonClass, cn, inputClass, labelClass, selectClass } from "@/components/ui";
import { LEAVE_LABELS, LEAVE_TYPES, WEEKDAY_NAMES, type HrPolicy, type Opening } from "@/lib/hr/policy";

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="text-xs font-semibold text-bad">{state.error}</p>;
  if (state.message) return <p className="text-xs font-semibold text-good">{state.message}</p>;
  return null;
}

// ── App time ────────────────────────────────────────────────────────────

/**
 * Sends one heartbeat a minute while the tab is visible and the person has used the mouse or
 * keyboard in the last `idleMinutes`. The server counts at most one per minute per person.
 */
export function ActivityTracker({ idleMinutes }: { idleMinutes: number }) {
  const pathname = usePathname();
  const path = useRef(pathname);
  path.current = pathname;
  useEffect(() => {
    let lastInput = Date.now();
    const mark = () => (lastInput = Date.now());
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"] as const;
    for (const e of events) window.addEventListener(e, mark, { passive: true });
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastInput > idleMinutes * 60_000) return;
      fetch("/api/hr/heartbeat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: path.current }), keepalive: true }).catch(
        () => undefined, // offline or signed out: this minute just isn't counted
      );
    };
    const id = window.setInterval(beat, 60_000);
    return () => {
      window.clearInterval(id);
      for (const e of events) window.removeEventListener(e, mark);
    };
  }, [idleMinutes]);
  return null;
}

// ── Leave request (everyone) ────────────────────────────────────────────

export function LeaveRequestForm({ today, wfhLeft }: { today: string; wfhLeft: number }) {
  const [state, action, pending] = useActionState(requestLeaveAction, {});
  const [type, setType] = useState<string>("casual");
  const [start, setStart] = useState(today);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);
  const half = type === "half_day";
  return (
    <form ref={formRef} action={action} className="grid gap-4 p-6 sm:grid-cols-2">
      <label>
        <span className={labelClass}>Type</span>
        <select name="type" value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
          {LEAVE_TYPES.map((t) => (
            <option key={t} value={t}>
              {LEAVE_LABELS[t]}
              {t === "wfh" ? ` (${wfhLeft} left this month)` : ""}
            </option>
          ))}
        </select>
      </label>
      {half ? (
        <label>
          <span className={labelClass}>Which half</span>
          <select name="session" className={selectClass} defaultValue="am">
            <option value="am">Morning (AM)</option>
            <option value="pm">Afternoon (PM)</option>
          </select>
        </label>
      ) : (
        <input type="hidden" name="session" value="full" />
      )}
      <label>
        <span className={labelClass}>{half ? "Date" : "First day"}</span>
        <input type="date" name="start_date" required value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
      </label>
      {!half && (
        <label>
          <span className={labelClass}>Last day</span>
          <input type="date" name="end_date" min={start} defaultValue="" placeholder="Same day" className={inputClass} />
        </label>
      )}
      <label className="sm:col-span-2">
        <span className={labelClass}>Reason {type === "sick" || type === "wfh" ? "(optional)" : ""}</span>
        <input name="reason" maxLength={500} placeholder={type === "wfh" ? "e.g. Waiting for a delivery" : "e.g. Brother's wedding"} className={inputClass} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className={buttonClass.primary} disabled={pending}>
          {pending ? "Sending…" : "Send request"}
        </button>
        <span className="text-xs text-muted">Leave the last day empty for a single day. HR approves requests within policy; anything else goes to Zain.</span>
      </div>
      <div className="sm:col-span-2">
        <Status state={state} />
      </div>
    </form>
  );
}

// ── Decisions (admins) ──────────────────────────────────────────────────

export function DecisionForm({ id, canCancel }: { id: string; canCancel?: boolean }) {
  const [state, action, pending] = useActionState(decideAction, {});
  if (state.ok) return <p className="text-xs font-semibold text-good">{state.message}</p>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="note" placeholder="Note (optional)" maxLength={500} className={cn(inputClass, "h-8 w-44 text-xs")} />
      {canCancel ? (
        <button name="action" value="cancel" disabled={pending} className={buttonClass.danger}>
          Cancel leave
        </button>
      ) : (
        <>
          <button name="action" value="approve" disabled={pending} className={cn(buttonClass.primary, buttonClass.small)}>
            Approve
          </button>
          <button name="action" value="decline" disabled={pending} className={buttonClass.danger}>
            Decline
          </button>
        </>
      )}
      <Status state={state} />
    </form>
  );
}

// ── Settings → HR ───────────────────────────────────────────────────────

function Num({ name, label, value, max = 60 }: { name: string; label: string; value: number; max?: number }) {
  return (
    <label className="text-xs font-semibold text-muted">
      {label}
      <input type="number" name={name} min={0} max={max} step={1} defaultValue={value} className={cn(inputClass, "mt-1 h-9 w-24 text-sm")} />
    </label>
  );
}

export function PolicyForm({ policy }: { policy: HrPolicy }) {
  const [state, action, pending] = useActionState(savePolicyAction, {});
  return (
    <form action={action} className="space-y-6 p-6">
      <fieldset className="flex flex-wrap items-end gap-4">
        <legend className="mb-2 text-sm font-bold text-ink">Office hours</legend>
        <label className="text-xs font-semibold text-muted">
          Start
          <input type="time" name="start_time" defaultValue={policy.startTime} className={cn(inputClass, "mt-1 h-9 w-32 text-sm")} />
        </label>
        <label className="text-xs font-semibold text-muted">
          End
          <input type="time" name="end_time" defaultValue={policy.endTime} className={cn(inputClass, "mt-1 h-9 w-32 text-sm")} />
        </label>
        <Num name="grace_minutes" label="Late after (minutes)" value={policy.graceMinutes} max={180} />
        <label className="text-xs font-semibold text-muted">
          Timezone
          <input name="timezone" defaultValue={policy.timezone} className={cn(inputClass, "mt-1 h-9 w-48 text-sm")} />
        </label>
        <div className="text-xs font-semibold text-muted">
          Working days
          <div className="mt-1 flex flex-wrap gap-1.5">
            {WEEKDAY_NAMES.map((d, i) => (
              <label key={d} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-sm text-ink has-checked:border-brand has-checked:bg-brand-soft">
                <input type="checkbox" name="work_days" value={i} defaultChecked={policy.workDays.includes(i)} className="accent-[var(--color-brand)]" />
                {d}
              </label>
            ))}
          </div>
        </div>
      </fieldset>
      <fieldset className="flex flex-wrap items-end gap-4">
        <legend className="mb-2 text-sm font-bold text-ink">Allowance (per year; WFH per month)</legend>
        <Num name="al_sick" label="Sick days" value={policy.allowance.sick} />
        <Num name="al_casual" label="Casual days" value={policy.allowance.casual} />
        <Num name="al_annual" label="Annual days" value={policy.allowance.annual} />
        <Num name="al_half_day" label="Half days" value={policy.allowance.half_day} />
        <Num name="al_wfh" label="WFH days / month" value={policy.allowance.wfh_per_month} max={31} />
      </fieldset>
      <fieldset className="flex flex-wrap items-end gap-4">
        <legend className="mb-2 text-sm font-bold text-ink">Notice needed (days before)</legend>
        <Num name="no_sick" label="Sick" value={policy.noticeDays.sick} />
        <Num name="no_casual" label="Casual" value={policy.noticeDays.casual} />
        <Num name="no_annual" label="Annual" value={policy.noticeDays.annual} />
        <Num name="no_half_day" label="Half day" value={policy.noticeDays.half_day} />
        <Num name="no_wfh" label="WFH" value={policy.noticeDays.wfh} />
      </fieldset>
      <fieldset className="flex flex-wrap items-end gap-4">
        <legend className="mb-2 text-sm font-bold text-ink">Other rules</legend>
        <Num name="sick_note_after" label="Medical note after (days)" value={policy.sickNoteAfterDays} />
        <Num name="sick_backdate" label="Sick can be logged after (days)" value={policy.sickBackdateDays} />
        <Num name="idle_minutes" label="App idle after (minutes)" value={policy.idleMinutes} />
      </fieldset>
      <div className="flex items-center gap-3">
        <button className={buttonClass.primary} disabled={pending}>
          {pending ? "Saving…" : "Save policy"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function PersonForm({
  email,
  name,
  displayName,
  deviceUserId,
  tracked,
  opening,
  deviceUsers,
  year,
}: {
  email: string;
  name: string;
  displayName: string | null;
  deviceUserId: string | null;
  tracked: boolean;
  opening: Opening;
  deviceUsers: Array<{ id: string; name: string | null }>;
  year: string;
}) {
  const [state, action] = useActionState(savePersonAction, {});
  const listId = `machine-${email}`;
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 px-6 py-4">
      <input type="hidden" name="email" value={email} />
      <div className="w-52 min-w-0">
        <div className="truncate text-sm font-bold text-ink">{name}</div>
        <div className="truncate text-xs text-muted">{email}</div>
      </div>
      <label className="text-xs font-semibold text-muted">
        Name
        <input name="display_name" defaultValue={displayName ?? ""} placeholder={name} className={cn(inputClass, "mt-1 h-9 w-36 text-sm")} />
      </label>
      <label className="text-xs font-semibold text-muted">
        Machine ID
        <input name="device_user_id" list={listId} defaultValue={deviceUserId ?? ""} placeholder="e.g. 3" className={cn(inputClass, "mt-1 h-9 w-24 text-sm")} />
        <datalist id={listId}>
          {deviceUsers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name ?? ""}
            </option>
          ))}
        </datalist>
      </label>
      <label className="flex h-9 items-center gap-2 text-sm font-semibold text-ink">
        <input type="checkbox" name="tracked" defaultChecked={tracked} className="accent-[var(--color-brand)]" />
        Track
      </label>
      <fieldset className="flex items-end gap-2 rounded-lg bg-canvas/70 px-3 py-2">
        <legend className="sr-only">Leave already taken in {year} before the app</legend>
        <span className="pb-2 text-xs font-semibold text-muted">Taken in {year} before the app:</span>
        {(
          [
            ["op_sick", "Sick", opening.sick],
            ["op_casual", "Casual", opening.casual],
            ["op_annual", "Annual", opening.annual],
            ["op_half_day", "Half days", opening.half_day],
          ] as const
        ).map(([n, l, v]) => (
          <label key={n} className="text-[11px] font-semibold text-muted">
            {l}
            <input type="number" name={n} min={0} max={60} step={0.5} defaultValue={v} className={cn(inputClass, "mt-0.5 h-8 w-16 text-sm")} />
          </label>
        ))}
      </fieldset>
      <PendingButton pendingText="Saving…" className={cn(buttonClass.secondary, buttonClass.small)}>
        Save
      </PendingButton>
      <div className="basis-full">
        <Status state={state} />
      </div>
    </form>
  );
}

export function HolidayForm() {
  const [state, action, pending] = useActionState(addHolidayAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 px-6 pt-5 pb-4">
      <label className="text-xs font-semibold text-muted">
        Date
        <input type="date" name="day" required className={cn(inputClass, "mt-1 h-9 w-44 text-sm")} />
      </label>
      <label className="text-xs font-semibold text-muted">
        Name
        <input name="name" required maxLength={80} placeholder="e.g. Eid ul-Fitr" className={cn(inputClass, "mt-1 h-9 w-56 text-sm")} />
      </label>
      <button className={cn(buttonClass.secondary, buttonClass.small)} disabled={pending}>
        {pending ? "Adding…" : "Add holiday"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function PunchUploadForm() {
  const [state, action, pending] = useActionState(uploadPunchesAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 px-6 py-4">
      <label className="text-xs font-semibold text-muted">
        Attendance log from the machine (USB export, e.g. 1_attlog.dat)
        <input type="file" name="file" accept=".dat,.txt,.csv,text/plain" required className="mt-1 block text-sm text-ink file:mr-3 file:rounded-pill file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-bold" />
      </label>
      <button className={cn(buttonClass.secondary, buttonClass.small)} disabled={pending}>
        {pending ? "Uploading…" : "Upload"}
      </button>
      <Status state={state} />
    </form>
  );
}
