import { Loader2 } from "lucide-react";

/** Shown instantly while a dashboard page's data loads (via loading.tsx). */
function Bar({ className }: { className: string }) {
  return <div className={`amz-skeleton rounded-md ${className}`} />;
}

export default function PageSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-3">
          <Bar className="h-3.5 w-28" />
          <Bar className="h-8 w-64" />
          <Bar className="h-3.5 w-80 max-w-full" />
        </div>
        <div className="inline-flex items-center gap-2 rounded-pill bg-gold-100 px-3 py-1.5 text-xs font-bold text-gold-800">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          Loading data…
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <Bar className="h-3.5 w-20" />
            <Bar className="mt-4 h-7 w-32" />
            <div className="mt-3 h-[3px] w-10 rounded-full bg-gold-200" />
            <Bar className="mt-4 h-3 w-36" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface shadow-card xl:col-span-2">
          <div className="border-b border-line px-6 py-4">
            <Bar className="h-4 w-48" />
          </div>
          <div className="flex h-72 items-end gap-2 px-6 pt-6 pb-5">
            {Array.from({ length: 24 }, (_, i) => (
              <div key={i} className="amz-skeleton flex-1 rounded-t-md" style={{ height: `${30 + ((i * 37) % 60)}%` }} />
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <div className="border-b border-line px-6 py-4">
            <Bar className="h-4 w-40" />
          </div>
          <div className="space-y-4 p-6">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="amz-skeleton size-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Bar className="h-3.5 w-3/5" />
                  <Bar className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-line bg-surface shadow-card">
        <div className="border-b border-line px-6 py-4">
          <Bar className="h-4 w-44" />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-6 border-b border-line px-6 py-4 last:border-0">
            <Bar className="h-3.5 w-1/3" />
            <Bar className="h-3.5 w-16" />
            <Bar className="h-3.5 w-20" />
            <Bar className="ml-auto h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
