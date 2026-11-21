"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { inviteMember, resendInvite, saveMember, sendPasswordReset, type TeamFormState } from "@/app/team-actions";
import { buttonClass, cn, inputClass, labelClass, selectClass } from "@/components/ui";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/rbac";

type Brand = { slug: string; name: string };
type Manager = { id: string; email: string };

function Status({ state }: { state: TeamFormState }) {
  if (state.error) return <p className="text-xs font-semibold text-bad">{state.error}</p>;
  if (state.message) return <p className="text-xs font-semibold text-good">{state.message}</p>;
  return null;
}

const ROLE_HINT: Record<Role, string> = {
  admin: "Everything, all brands, Settings",
  brand_manager: "Their brands, goals, meetings, team tasks",
  ppc_manager: "Campaigns, search terms, hourly",
  catalog_manager: "Products, listing & price actions",
};

/** Role checkboxes, brand checkboxes and "reports to" — shared by invite and edit. */
function AccessFields({
  brands,
  managers,
  roles: initialRoles = [],
  assigned = [],
  reportsTo = null,
  selfId,
}: {
  brands: Brand[];
  managers: Manager[];
  roles?: Role[];
  assigned?: string[];
  reportsTo?: string | null;
  selfId?: string;
}) {
  const [roles, setRoles] = useState<Role[]>(initialRoles);
  const [picked, setPicked] = useState<string[]>(assigned);
  const adminOnly = roles.length > 0 && roles.every((r) => r === "admin");
  return (
    <div className="grid gap-5 md:grid-cols-12">
      <fieldset className="md:col-span-4">
        <legend className={labelClass}>Roles</legend>
        <div className="space-y-2">
          {ROLES.map((r) => (
            <label key={r} className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                name="role"
                value={r}
                checked={roles.includes(r)}
                onChange={(e) => setRoles((cur) => (e.target.checked ? [...cur, r] : cur.filter((x) => x !== r)))}
                className="mt-0.5 size-4 accent-[#f8a42e]"
              />
              <span>
                <span className="font-semibold text-ink">{ROLE_LABELS[r]}</span>
                <span className="block text-xs text-muted">{ROLE_HINT[r]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="md:col-span-5">
        <legend className={labelClass}>
          Brands {adminOnly ? <span className="font-normal text-muted">(admins see all brands)</span> : <span className="font-normal text-muted">({picked.length} selected)</span>}
        </legend>
        <div className="flex max-h-44 flex-col gap-1.5 overflow-y-auto rounded-lg border border-line p-2.5">
          {brands.length === 0 && <span className="text-xs text-muted">No brands yet.</span>}
          {brands.map((b) => (
            <label key={b.slug} className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                name="brand"
                value={b.slug}
                checked={picked.includes(b.slug)}
                onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, b.slug] : cur.filter((x) => x !== b.slug)))}
                className="size-4 accent-[#f8a42e]"
              />
              <span className="text-ink">{b.name}</span>
            </label>
          ))}
        </div>
        {brands.length > 1 && (
          <div className="mt-1.5 flex gap-3 text-[11px] font-semibold">
            <button type="button" className="text-brand-ink hover:underline" onClick={() => setPicked(brands.map((b) => b.slug))}>
              Select all
            </button>
            <button type="button" className="text-muted hover:underline" onClick={() => setPicked([])}>
              Clear
            </button>
          </div>
        )}
      </fieldset>
      <label className="md:col-span-3">
        <span className={labelClass}>Reports to</span>
        <select name="reports_to" defaultValue={reportsTo ?? ""} className={selectClass}>
          <option value="">Nobody</option>
          {managers
            .filter((m) => m.id !== selfId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.email}
              </option>
            ))}
        </select>
        <span className="mt-1 block text-xs text-muted">Their brand manager can see and assign their tasks.</span>
      </label>
    </div>
  );
}

export function InviteForm({ brands, managers }: { brands: Brand[]; managers: Manager[] }) {
  const [state, action, pending] = useActionState(inviteMember, {});
  return (
    <form action={action} className="space-y-5 p-6" key={state.ok ? `ok-${state.message}` : "invite"}>
      <label className="block max-w-md">
        <span className={labelClass}>Work email</span>
        <input type="email" name="email" placeholder="name@amzcentric.com" className={inputClass} required />
      </label>
      <AccessFields brands={brands} managers={managers} />
      <div className="flex items-center gap-3">
        <button className={buttonClass.primary} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {pending ? "Sending…" : "Send invite"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function MemberForm({
  userId,
  brands,
  managers,
  roles,
  assigned,
  reportsTo,
}: {
  userId: string;
  brands: Brand[];
  managers: Manager[];
  roles: Role[];
  assigned: string[];
  reportsTo: string | null;
}) {
  const [state, action, pending] = useActionState(saveMember, {});
  return (
    <form action={action} className="space-y-4 border-t border-line bg-canvas/50 px-6 py-5">
      <input type="hidden" name="user_id" value={userId} />
      <AccessFields brands={brands} managers={managers} roles={roles} assigned={assigned} reportsTo={reportsTo} selfId={userId} />
      <div className="flex items-center gap-3">
        <button className={cn(buttonClass.primary, buttonClass.small)} disabled={pending}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {pending ? "Saving…" : "Save access"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

/** Resend a pending invite, or (admins only) email a password reset. */
export function AccountActions({ userId, invited }: { userId: string; invited: boolean }) {
  const [state, action, pending] = useActionState(invited ? resendInvite : sendPasswordReset, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="user_id" value={userId} />
      <button className={cn(buttonClass.secondary, buttonClass.small)} disabled={pending}>
        {pending && <Loader2 className="size-3.5 animate-spin" />}
        {invited ? "Resend invite" : "Send password reset"}
      </button>
      <Status state={state} />
    </form>
  );
}
