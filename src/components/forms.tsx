"use client";

import { useActionState } from "react";
import { addAction, saveGoal, type FormState } from "@/app/workspace-actions";
import { buttonClass, inputClass, labelClass, selectClass } from "@/components/ui";
import { ACTION_CATEGORIES } from "@/lib/data/types";

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="text-xs font-semibold text-bad">{state.error}</p>;
  if (state.message) return <p className="text-xs font-semibold text-good">{state.message}</p>;
  return null;
}

export function ActionForm({
  brand,
  today,
  campaigns,
}: {
  brand: string;
  today: string;
  campaigns: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState(addAction, {});
  return (
    <form action={action} className="grid gap-4 p-6 md:grid-cols-12" key={state.ok ? Date.now() : "form"}>
      <input type="hidden" name="brand" value={brand} />
      <label className="md:col-span-2">
        <span className={labelClass}>Date</span>
        <input type="date" name="action_date" defaultValue={today} max={today} className={inputClass} required />
      </label>
      <label className="md:col-span-2">
        <span className={labelClass}>Category</span>
        <select name="category" className={selectClass} defaultValue="bid">
          {ACTION_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="md:col-span-3">
        <span className={labelClass}>Campaign (optional)</span>
        <select name="campaign" className={selectClass} defaultValue="">
          <option value="">Whole brand</option>
          {campaigns.map((c) => (
            <option key={c.id} value={`${c.id}::${c.name}`}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="md:col-span-5">
        <span className={labelClass}>What did you do?</span>
        <input name="description" placeholder="e.g. Raised exact-match bids 15% on top 5 keywords" className={inputClass} required />
      </label>
      <div className="flex items-center gap-3 md:col-span-12">
        <button className={buttonClass.primary} disabled={pending}>
          {pending ? "Saving…" : "Log action"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function GoalForm({
  brand,
  month,
  goal,
}: {
  brand: string;
  month: string;
  goal: { salesTarget: number | null; spendBudget: number | null; acosTarget: number | null } | null;
}) {
  const [state, action, pending] = useActionState(saveGoal, {});
  return (
    <form action={action} className="grid gap-4 p-6 sm:grid-cols-3">
      <input type="hidden" name="brand" value={brand} />
      <input type="hidden" name="month" value={month} />
      <label>
        <span className={labelClass}>Sales target ($)</span>
        <input name="sales_target" inputMode="decimal" defaultValue={goal?.salesTarget ?? ""} className={inputClass} />
      </label>
      <label>
        <span className={labelClass}>Ad spend budget ($)</span>
        <input name="spend_budget" inputMode="decimal" defaultValue={goal?.spendBudget ?? ""} className={inputClass} />
      </label>
      <label>
        <span className={labelClass}>ACOS target (%)</span>
        <input
          name="acos_target"
          inputMode="decimal"
          defaultValue={goal?.acosTarget != null ? +(goal.acosTarget * 100).toFixed(1) : ""}
          className={inputClass}
        />
      </label>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button className={buttonClass.primary} disabled={pending}>
          {pending ? "Saving…" : "Save goal"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}
