"use client";

import { useActionState } from "react";
import { addAction, saveGoal, type FormState } from "@/app/workspace-actions";
import { buttonClass, inputClass } from "@/components/ui";
import { ACTION_CATEGORIES } from "@/lib/data/types";

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="text-xs text-bad">{state.error}</p>;
  if (state.message) return <p className="text-xs text-good">{state.message}</p>;
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
    <form action={action} className="grid gap-3 p-5 md:grid-cols-12" key={state.ok ? Date.now() : "form"}>
      <input type="hidden" name="brand" value={brand} />
      <label className="md:col-span-2">
        <span className="mb-1 block text-xs font-medium text-muted">Date</span>
        <input type="date" name="action_date" defaultValue={today} max={today} className={inputClass} required />
      </label>
      <label className="md:col-span-2">
        <span className="mb-1 block text-xs font-medium text-muted">Category</span>
        <select name="category" className={inputClass} defaultValue="bid">
          {ACTION_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="md:col-span-3">
        <span className="mb-1 block text-xs font-medium text-muted">Campaign (optional)</span>
        <select name="campaign" className={inputClass} defaultValue="">
          <option value="">Whole brand</option>
          {campaigns.map((c) => (
            <option key={c.id} value={`${c.id}::${c.name}`}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="md:col-span-5">
        <span className="mb-1 block text-xs font-medium text-muted">What did you do?</span>
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
    <form action={action} className="grid gap-3 p-5 sm:grid-cols-3">
      <input type="hidden" name="brand" value={brand} />
      <input type="hidden" name="month" value={month} />
      <label>
        <span className="mb-1 block text-xs font-medium text-muted">Sales target ($)</span>
        <input name="sales_target" inputMode="decimal" defaultValue={goal?.salesTarget ?? ""} className={inputClass} />
      </label>
      <label>
        <span className="mb-1 block text-xs font-medium text-muted">Ad spend budget ($)</span>
        <input name="spend_budget" inputMode="decimal" defaultValue={goal?.spendBudget ?? ""} className={inputClass} />
      </label>
      <label>
        <span className="mb-1 block text-xs font-medium text-muted">ACOS target (%)</span>
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
