import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { RANGE_OPTIONS } from "@/lib/dates";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--color-brand)" />
        <path d="M9 23 16 8l7 15" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11 20c3 2.2 7 2.2 10 0" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight text-ink">
        AmzCentric<span className="ml-1.5 rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-semibold text-white">OS</span>
      </span>
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("rounded-2xl border border-line bg-surface", className)}>{children}</section>;
}

export function CardHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</h2>
      {right}
    </div>
  );
}

export function Eyebrow({ children, tone = "brand" }: { children: React.ReactNode; tone?: "brand" | "accent" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
        tone === "brand" ? "bg-brand-soft text-brand" : "bg-accent-soft text-warn",
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </header>
  );
}

export function Pill({
  children,
  tone = "neutral",
  dot,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "bad" | "warn" | "brand";
  dot?: boolean;
}) {
  const tones = {
    neutral: "border-line bg-surface text-ink-2",
    good: "border-good/20 bg-good-soft text-good",
    bad: "border-bad/20 bg-bad-soft text-bad",
    warn: "border-warn/20 bg-warn-soft text-warn",
    brand: "border-brand/20 bg-brand-soft text-brand",
  } as const;
  const dots = { neutral: "bg-faint", good: "bg-good", bad: "bg-bad", warn: "bg-warn", brand: "bg-brand" } as const;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", tones[tone])}>
      {dot && <span className={cn("size-1.5 rounded-full", dots[tone])} />}
      {children}
    </span>
  );
}

/** Δ% where "up" can be good (sales) or bad (ACOS, spend). */
export function Delta({ value, invert = false, className }: { value: number | null; invert?: boolean; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={cn("text-xs text-faint", className)}>—</span>;
  const up = value >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold tabular", good ? "text-good" : "text-bad", className)}>
      <Icon className="size-3.5" strokeWidth={2} />
      {Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}

export function Kpi({
  label,
  value,
  sub,
  delta,
  invert,
  badge,
  highlight,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  delta?: number | null;
  invert?: boolean;
  badge?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card className={cn("relative overflow-hidden px-5 py-4", highlight && "ring-1 ring-brand/30")}>
      {highlight && <div className="absolute inset-x-0 top-0 h-[3px] bg-brand" />}
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
        {badge}
      </div>
      <div className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-ink tabular">{value}</div>
      {sub && <div className="mt-2 text-xs text-muted tabular">{sub}</div>}
      {delta !== undefined && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Delta value={delta} invert={invert} />
          <span className="text-[11px] text-faint">vs prior</span>
        </div>
      )}
    </Card>
  );
}

export function RangeTabs({ basePath, current, extra }: { basePath: string; current: number; extra?: Record<string, string> }) {
  return (
    <div className="inline-flex rounded-full border border-line bg-surface p-0.5">
      {RANGE_OPTIONS.map((d) => (
        <Link
          key={d}
          href={`${basePath}?${new URLSearchParams({ ...extra, range: String(d) })}`}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            d === current ? "bg-ink text-white" : "text-muted hover:text-ink",
          )}
        >
          {d}d
        </Link>
      ))}
    </div>
  );
}

export function Tabs({ items }: { items: Array<{ href: string; label: string; active: boolean; count?: number }> }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line px-5">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium",
            t.active ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 rounded-full bg-canvas px-1.5 py-0.5 text-[11px] text-muted">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-bad/30 bg-surface px-3 py-1.5 text-xs font-medium text-bad hover:bg-bad-soft",
};

export const inputClass =
  "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15";
