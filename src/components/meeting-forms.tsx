"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { createMeeting, createTask, updateTask, type FormState } from "@/app/meeting-actions";
import { buttonClass, cn, inputClass, labelClass, selectClass } from "@/components/ui";
import type { Task } from "@/lib/meetings/store";

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="text-xs font-semibold text-bad">{state.error}</p>;
  if (state.message) return <p className="text-xs font-semibold text-good">{state.message}</p>;
  return null;
}

export function MeetingForm({ brand, today, aiEnabled }: { brand: string; today: string; aiEnabled: boolean }) {
  const [state, action, pending] = useActionState(createMeeting, {});
  const [chars, setChars] = useState(0);
  return (
    <form action={action} className="grid gap-4 p-6 md:grid-cols-12">
      <input type="hidden" name="brand" value={brand} />
      <label className="md:col-span-8">
        <span className={labelClass}>Title</span>
        <input name="title" defaultValue="Weekly call" className={inputClass} maxLength={200} />
      </label>
      <label className="md:col-span-4">
        <span className={labelClass}>Meeting date</span>
        <input type="date" name="meeting_date" defaultValue={today} className={inputClass} required />
      </label>
      <label className="md:col-span-12">
        <span className={labelClass}>Meeting notes or transcript</span>
        <textarea
          name="notes"
          required
          rows={12}
          onChange={(e) => setChars(e.target.value.length)}
          placeholder={"Paste Claude's meeting notes, a Fireflies / Otter summary, or the full transcript.\n\ne.g.\n- Client wants to push Black Friday harder\n- Ali to cut broad bids 15% by Friday\n- Coupon approved: 20% off for BF week"}
          className={cn(inputClass, "h-auto min-h-[220px] resize-y py-3 leading-relaxed")}
        />
        <span className="mt-1 block text-right text-[11px] text-faint tabular">{chars ? `${chars.toLocaleString()} characters` : ""}</span>
      </label>
      <div className="flex flex-wrap items-center gap-3 md:col-span-12">
        <button className={buttonClass.primary} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" strokeWidth={2} />}
          {pending ? "Saving…" : aiEnabled ? "Save & generate insights" : "Save notes"}
        </button>
        <Status state={state} />
        {!aiEnabled && <p className="text-xs text-muted">Automatic insights are off until ANTHROPIC_API_KEY is set — notes still save.</p>}
      </div>
    </form>
  );
}

function OwnerInput({ team, defaultValue, id }: { team: string[]; defaultValue?: string; id: string }) {
  return (
    <>
      <input name="owner" list={id} defaultValue={defaultValue} placeholder="Teammate email or a name" className={inputClass} />
      <datalist id={id}>
        {team.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
    </>
  );
}

export function TaskForm({
  brand,
  team,
  meetingId,
  me,
  lockOwner = false,
}: {
  brand: string;
  team: string[];
  meetingId?: string;
  me: string;
  /** PPC / catalog managers create tasks for themselves only. */
  lockOwner?: boolean;
}) {
  const [state, action, pending] = useActionState(createTask, {});
  return (
    <form action={action} className="grid gap-4 p-6 md:grid-cols-12" key={state.ok ? `ok-${Date.now()}` : "form"}>
      <input type="hidden" name="brand" value={brand} />
      {meetingId && <input type="hidden" name="meeting_id" value={meetingId} />}
      <label className="md:col-span-5">
        <span className={labelClass}>Task</span>
        <input name="title" required placeholder="e.g. Launch SB video for the gift set" className={inputClass} maxLength={300} />
      </label>
      <label className="md:col-span-3">
        <span className={labelClass}>Owner</span>
        {lockOwner ? (
          <>
            <input type="hidden" name="owner" value={me} />
            <input value={`${me} (you)`} readOnly className={cn(inputClass, "bg-canvas text-muted")} />
          </>
        ) : (
          <OwnerInput team={team} defaultValue={me} id={`team-${meetingId ?? brand}`} />
        )}
      </label>
      <label className="md:col-span-2">
        <span className={labelClass}>Due</span>
        <input type="date" name="due_date" className={inputClass} />
      </label>
      <label className="md:col-span-2">
        <span className={labelClass}>Priority</span>
        <select name="priority" defaultValue="medium" className={selectClass}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
      <label className="md:col-span-12">
        <span className={labelClass}>Details (optional)</span>
        <input name="detail" className={inputClass} />
      </label>
      <div className="flex items-center gap-3 md:col-span-12">
        <button className={buttonClass.secondary} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {pending ? "Adding…" : "Add task"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function TaskEditForm({ task, team }: { task: Task; team: string[] }) {
  const [state, action, pending] = useActionState(updateTask, {});
  return (
    <form action={action} className="mt-3 grid gap-3 rounded-xl border border-line bg-canvas p-4 md:grid-cols-12">
      <input type="hidden" name="id" value={task.id} />
      <input type="hidden" name="brand" value={task.brandSlug} />
      <label className="md:col-span-12">
        <span className={labelClass}>Task</span>
        <input name="title" defaultValue={task.title} required className={inputClass} maxLength={300} />
      </label>
      <label className="md:col-span-5">
        <span className={labelClass}>Owner</span>
        <OwnerInput team={team} defaultValue={task.ownerEmail ?? task.ownerName ?? ""} id={`team-edit-${task.id}`} />
      </label>
      <label className="md:col-span-4">
        <span className={labelClass}>Due</span>
        <input type="date" name="due_date" defaultValue={task.dueDate ?? ""} className={inputClass} />
      </label>
      <label className="md:col-span-3">
        <span className={labelClass}>Priority</span>
        <select name="priority" defaultValue={task.priority} className={selectClass}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
      <label className="md:col-span-12">
        <span className={labelClass}>Details</span>
        <input name="detail" defaultValue={task.detail ?? ""} className={inputClass} />
      </label>
      <div className="flex items-center gap-3 md:col-span-12">
        <button className={cn(buttonClass.primary, buttonClass.small)} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

/** Re-fetches the page every few seconds while Claude is still analyzing. */
export function AutoRefresh({ active, every = 4000 }: { active: boolean; every?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => router.refresh(), every);
    const stop = window.setTimeout(() => window.clearInterval(t), 6 * 60_000);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
  }, [active, every, router]);
  return null;
}
