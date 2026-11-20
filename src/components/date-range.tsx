"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarRange, Loader2 } from "lucide-react";
import { LinkPulse } from "@/components/link-pending";
import { startNavigation } from "@/components/nav-progress";
import { buttonClass, cn, inputClass, labelClass, segmentedClass, segmentedItemClass } from "@/components/ui";

const PRESETS = [7, 14, 30, 60, 90];

function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function short(ymd: string) {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * 7D / 14D / 30D / 60D / 90D presets plus a "Custom" from–to picker.
 * The URL carries either ?range=30 or ?from=YYYY-MM-DD&to=YYYY-MM-DD.
 */
export function RangePicker({
  basePath,
  range,
  maxDate,
  extra,
}: {
  basePath: string;
  range: { days: number; from: string; to: string; custom?: boolean };
  /** Last day with a complete Amazon report. */
  maxDate: string;
  extra?: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFrom(range.from);
    setTo(range.to);
  }, [range.from, range.to]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const valid = !!from && !!to && from <= to && to <= maxDate;
  const apply = () => {
    if (!valid) return;
    startNavigation();
    start(() => {
      router.push(`${basePath}?${new URLSearchParams({ ...extra, from, to })}`);
      setOpen(false);
    });
  };
  const quick = (label: string, f: string, t: string) => (
    <button
      type="button"
      onClick={() => {
        setFrom(f);
        setTo(t);
      }}
      className="rounded-pill border border-line px-3 py-1 text-xs font-semibold text-ink-2 hover:border-brand hover:text-brand-ink"
    >
      {label}
    </button>
  );
  const monthStart = `${maxDate.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;

  return (
    <div ref={box} className="relative flex flex-wrap items-center gap-2">
      <div className={segmentedClass}>
        {PRESETS.map((d) => (
          <Link
            key={d}
            href={`${basePath}?${new URLSearchParams({ ...extra, range: String(d) })}`}
            className={segmentedItemClass(!range.custom && range.days === d)}
          >
            <LinkPulse>{`${d}D`}</LinkPulse>
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(segmentedItemClass(!!range.custom), "gap-1.5")}
        >
          <CalendarRange className="size-3.5" strokeWidth={2} />
          {range.custom ? `${short(range.from)} – ${short(range.to)}` : "Custom"}
        </button>
      </div>

      {open && (
        <div className="absolute top-full right-0 z-30 mt-2 w-[min(340px,calc(100vw-32px))] rounded-xl border border-line bg-surface p-4 shadow-raised">
          <div className="text-sm font-bold text-ink">Custom date range</div>
          <div className="mt-0.5 text-xs text-muted">Compared with the same number of days just before it.</div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>From</span>
              <input type="date" className={inputClass} value={from} max={to || maxDate} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="block">
              <span className={labelClass}>To</span>
              <input type="date" className={inputClass} value={to} min={from} max={maxDate} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {quick("This month", monthStart, maxDate)}
            {quick("Last month", lastMonthStart, lastMonthEnd)}
            {quick("Last 180 days", addDays(maxDate, -179), maxDate)}
          </div>
          {!valid && from && to && (
            <div className="mt-2 text-xs text-bad">
              {from > to ? "“From” must be on or before “To”." : `Reports are complete through ${short(maxDate)}.`}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={cn(buttonClass.ghost, buttonClass.small)} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className={cn(buttonClass.primary, buttonClass.small)} disabled={!valid || pending} onClick={apply}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
