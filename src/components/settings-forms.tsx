"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Play, RefreshCw, Radio } from "lucide-react";
import { createBrand, inviteMember } from "@/app/settings-actions";
import type { FormState } from "@/app/workspace-actions";
import { buttonClass, cn, inputClass, labelClass, segmentedClass, segmentedItemClass, selectClass } from "@/components/ui";

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="text-xs font-semibold text-bad">{state.error}</p>;
  if (state.message) return <p className="text-xs font-semibold text-good">{state.message}</p>;
  return null;
}

export function BrandForm() {
  const [state, action, pending] = useActionState(createBrand, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-4 p-6">
      <label className="min-w-56 flex-1">
        <span className={labelClass}>Brand name</span>
        <input name="name" placeholder="e.g. Harbor & Pine" className={inputClass} required />
      </label>
      <label className="w-48">
        <span className={labelClass}>URL slug (optional)</span>
        <input name="slug" placeholder="harbor-pine" className={inputClass} />
      </label>
      <button className={buttonClass.primary} disabled={pending}>
        {pending ? "Creating…" : "Add brand"}
      </button>
      <div className="basis-full">
        <Status state={state} />
      </div>
    </form>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMember, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-4 p-6">
      <label className="min-w-64 flex-1">
        <span className={labelClass}>Work email</span>
        <input type="email" name="email" placeholder="name@amzcentric.com" className={inputClass} required />
      </label>
      <label className="w-40">
        <span className={labelClass}>Role</span>
        <select name="role" className={selectClass} defaultValue="member">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <button className={buttonClass.primary} disabled={pending}>
        {pending ? "Sending…" : "Send invite"}
      </button>
      <div className="basis-full">
        <Status state={state} />
      </div>
    </form>
  );
}

type Profile = { id: string; label: string };

export function SyncPanel({ profiles, streamConfigured }: { profiles: Profile[]; streamConfigured: boolean }) {
  const router = useRouter();
  const [days, setDays] = useState(60);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const run = async (key: string, url: string, body?: unknown) => {
    setBusy(key);
    setResult(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      setResult(res.ok ? summarize(json) : `Error: ${json.error ?? res.status}`);
      router.refresh();
    } catch (e) {
      setResult(`Error: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-8 p-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="text-[16px] font-bold text-ink">Backfill history</div>
        <p className="mt-0.5 text-xs text-muted">
          Requests campaign, search-term and product reports in 31-day chunks (Amazon keeps ~95 days; SB 60). Then run
          &ldquo;Check reports&rdquo; or wait for the 30-minute cron.
        </p>
        <div className={cn(segmentedClass, "mt-4")}>
          {[30, 60, 95].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={segmentedItemClass(days === d)}>
              {d} days
            </button>
          ))}
        </div>
        <div className="mt-4 max-h-44 overflow-y-auto rounded-lg border border-line-strong p-1.5">
          {profiles.length === 0 && <p className="p-2 text-xs text-muted">No enabled profiles. Enable some under Connections.</p>}
          {profiles.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:bg-canvas">
              <input
                type="checkbox"
                className="amz-check"
                checked={selected.includes(p.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))}
              />
              {p.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-faint">Leave all unchecked to backfill every enabled profile.</p>
        <button
          className={cn(buttonClass.primary, "mt-4")}
          disabled={!!busy || profiles.length === 0}
          onClick={() => run("backfill", "/api/backfill", { days, profileIds: selected })}
        >
          {busy === "backfill" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" strokeWidth={1.5} />}
          Request {days}-day backfill
        </button>
      </div>
      <div className="space-y-3">
        <div className="text-[16px] font-bold text-ink">Run now</div>
        <button className={`${buttonClass.secondary} w-full`} disabled={!!busy} onClick={() => run("poll", "/api/poll")}>
          {busy === "poll" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" strokeWidth={1.5} />}
          Check reports &amp; download
        </button>
        <button
          className={`${buttonClass.secondary} w-full`}
          disabled={!!busy || !streamConfigured}
          onClick={() => run("stream", "/api/stream-ingest")}
          title={streamConfigured ? undefined : "Set STREAM_SQS_QUEUE_URLS first"}
        >
          {busy === "stream" ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" strokeWidth={1.5} />}
          Pull Marketing Stream (SQS)
        </button>
        {result && <pre className="rounded-lg bg-navy-800 p-3 font-mono text-[11px] whitespace-pre-wrap text-[#c4cedb]">{result}</pre>}
      </div>
    </div>
  );
}

function summarize(json: Record<string, unknown>): string {
  return Object.entries(json)
    .filter(([, v]) => !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.slice(0, 5).join("\n  ") : String(v)}`)
    .join("\n");
}

/** Submit button that shows a spinner while its form's server action runs. */
export function PendingButton({ children, pendingText, className }: { children: React.ReactNode; pendingText: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {pending ? pendingText : children}
    </button>
  );
}
