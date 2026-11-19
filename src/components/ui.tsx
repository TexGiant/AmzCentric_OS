import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { RANGE_OPTIONS } from "@/lib/dates";
import { LinkPulse } from "@/components/link-pending";

/*
 * React versions of the AmzCentric CSS components (.amz-*), built on the
 * Tailwind tokens in globals.css.
 */

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Official logo (light surfaces). `product` adds the small "OS" tag. */
export function Logo({ className, size = "md", product = true }: { className?: string; size?: "sm" | "nav" | "md" | "lg"; product?: boolean }) {
  const h = { sm: "h-[22px]", nav: "h-6", md: "h-7", lg: "h-10" }[size];
  return (
    <span className={cn("inline-flex items-end gap-2", className)}>
      <Image src="/brand/amzcentric-logo.png" alt="AmzCentric" width={983} height={154} priority className={cn(h, "w-auto max-w-none")} />
      {product && (
        <span className="mb-[3px] rounded-[4px] bg-navy-800 px-1.5 py-[3px] font-display text-[10px] leading-none font-bold tracking-[0.08em] text-white">
          OS
        </span>
      )}
    </span>
  );
}

// ── Surfaces ───────────────────────────────────────────────────────────

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("rounded-2xl border border-line bg-surface shadow-card", className)}>{children}</section>;
}

/** .amz-card__header — sentence-case title, optional right slot, bottom rule. */
export function CardHeader({ title, right, sub }: { title: string; right?: React.ReactNode; sub?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-6 py-4">
      <div className="min-w-0">
        <h2 className="text-[16px] font-bold text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** Navy panel (.amz-card--navy / .amz-theme-dark). */
export function NavyPanel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("rounded-2xl bg-navy-800 text-[#c4cedb]", className)}>{children}</section>;
}

// ── Typography ─────────────────────────────────────────────────────────

/** .amz-eyebrow — "[ LABEL ]" in amber. */
export function Eyebrow({ children, className, onDark }: { children: React.ReactNode; className?: string; onDark?: boolean }) {
  return (
    <span className={cn("text-[13px] font-bold tracking-[0.04em] uppercase", onDark ? "text-brand" : "text-brand-ink", className)}>
      [ {children} ]
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
    <header className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="mt-2 font-display text-[26px] leading-[1.15] font-semibold tracking-[-0.01em] text-ink sm:text-[30px]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </header>
  );
}

// ── Badges & deltas ────────────────────────────────────────────────────

export type Tone = "neutral" | "good" | "bad" | "warn" | "brand" | "info" | "solid" | "outline";

const BADGE: Record<Tone, string> = {
  neutral: "bg-[#f1f5f9] text-ink-2",
  good: "bg-good-soft text-good-ink",
  bad: "bg-bad-soft text-bad-ink",
  warn: "bg-warn-soft text-warn-ink",
  brand: "bg-gold-100 text-gold-800",
  info: "bg-info-soft text-info-ink",
  solid: "bg-brand text-navy-900",
  outline: "bg-transparent text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
};

export function badgeClass(tone: Tone = "neutral") {
  return cn("inline-flex h-6 items-center gap-1.5 rounded-pill px-2.5 text-xs font-bold whitespace-nowrap", BADGE[tone]);
}

/** .amz-badge (with optional .amz-badge--dot). */
export function Pill({ children, tone = "neutral", dot }: { children: React.ReactNode; tone?: Tone; dot?: boolean }) {
  return (
    <span className={badgeClass(tone)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** .amz-delta — ▲/▼ with success/danger. `invert` when lower is better (ACOS, spend). */
export function Delta({ value, invert = false, className }: { value: number | null; invert?: boolean; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={cn("text-xs text-faint", className)}>—</span>;
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-bold tabular", good ? "text-good" : "text-bad", className)}>
      <span className="text-[8px]">{up ? "▲" : "▼"}</span>
      {up ? "+" : "−"}
      {Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}

// ── KPI / stat ─────────────────────────────────────────────────────────

/** "$525,937.42" → big "$525,937" + small ".42" so figures with cents stay compact. */
export function Figure({ value }: { value: string }) {
  const m = value.match(/^(-?\$[\d,]+)(\.\d+)$/);
  if (!m) return <>{value}</>;
  return (
    <>
      {m[1]}
      <span className="text-[0.62em] tracking-normal">{m[2]}</span>
    </>
  );
}

/** .amz-stat inside a card: label, Montserrat figure, amber bar, meta row. */
export function Kpi({
  label,
  value,
  sub,
  delta,
  invert,
  badge,
  highlight,
  size = "md",
  unit,
}: {
  label: string;
  value: string;
  /** Small caption after the figure, e.g. "ad sales". */
  unit?: string;
  sub?: React.ReactNode;
  delta?: number | null;
  invert?: boolean;
  badge?: React.ReactNode;
  highlight?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <Card className={cn("flex flex-col px-5 py-5", highlight && "border-brand ring-1 ring-brand")}>
      <div className="flex items-center gap-2 text-sm font-semibold text-muted">
        {label}
        {badge}
      </div>
      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-1.5">
        <span
          className={cn(
            "font-display leading-none font-bold tracking-[-0.01em] text-ink tabular",
            size === "sm" ? "text-[22px]" : "text-[28px]",
          )}
        >
          <Figure value={value} />
        </span>
        {unit && <span className="text-xs font-semibold text-muted">{unit}</span>}
      </div>
      <div className="mt-3 h-[3px] w-10 rounded-full bg-brand" />
      {sub && <div className="mt-2.5 text-xs leading-relaxed text-muted tabular">{sub}</div>}
      {delta !== undefined && (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
          <Delta value={delta} invert={invert} />
          vs prior
        </div>
      )}
    </Card>
  );
}

/** Stat on a navy panel. */
export function NavyStat({ label, value, delta, invert }: { label: string; value: string; delta?: number | null; invert?: boolean }) {
  return (
    <div>
      <div className="text-sm font-semibold text-[#8da0b8]">{label}</div>
      <div className="mt-2 font-display text-[28px] leading-none font-bold tracking-[-0.01em] text-white tabular">
        <Figure value={value} />
      </div>
      <div className="mt-3 h-[3px] w-10 rounded-full bg-brand" />
      {delta !== undefined && (
        <div className="mt-2 flex items-center gap-2 text-xs text-[#8da0b8]">
          <Delta value={delta} invert={invert} className="[&.text-bad]:text-[#f87171] [&.text-good]:text-[#4ade80]" />
          vs prior
        </div>
      )}
    </div>
  );
}

// ── Navigation ─────────────────────────────────────────────────────────

export function segmentedItemClass(active: boolean) {
  return cn(
    "inline-flex h-[30px] items-center rounded-pill px-4 text-xs font-bold whitespace-nowrap transition-colors",
    active ? "bg-brand text-navy-900" : "text-muted hover:text-ink",
  );
}

export const segmentedClass = "inline-flex flex-wrap gap-0.5 rounded-pill border border-line bg-canvas p-[3px]";

/** .amz-segmented with links. */
export function Segmented({ items }: { items: Array<{ href: string; label: string; active: boolean }> }) {
  return (
    <div className={segmentedClass}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={segmentedItemClass(i.active)}>
          <LinkPulse>{i.label}</LinkPulse>
        </Link>
      ))}
    </div>
  );
}

export function RangeTabs({ basePath, current, extra }: { basePath: string; current: number; extra?: Record<string, string> }) {
  return (
    <Segmented
      items={RANGE_OPTIONS.map((d) => ({
        href: `${basePath}?${new URLSearchParams({ ...extra, range: String(d) })}`,
        label: `${d}D`,
        active: d === current,
      }))}
    />
  );
}

/** .amz-tabs — amber underline on the active tab. */
export function Tabs({ items }: { items: Array<{ href: string; label: string; active: boolean; count?: number }> }) {
  return (
    <div className="flex gap-6 overflow-x-auto border-b border-line px-6">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "relative inline-flex items-center gap-1.5 py-3.5 text-sm font-semibold whitespace-nowrap transition-colors",
            t.active
              ? "text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand"
              : "text-muted hover:text-ink",
          )}
        >
          <LinkPulse>{t.label}</LinkPulse>
          {t.count != null && (
            <span className={cn("rounded-pill px-2 py-0.5 text-[11px] font-bold", t.active ? "bg-gold-100 text-gold-800" : "bg-canvas text-muted")}>
              {t.count}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

// ── Feedback ───────────────────────────────────────────────────────────

/** .amz-icon-chip */
export function IconChip({ children, tone = "brand" }: { children: React.ReactNode; tone?: "brand" | "good" | "bad" | "warn" | "info" }) {
  const tones = {
    brand: "bg-brand-soft text-brand-ink",
    good: "bg-good-soft text-good",
    bad: "bg-bad-soft text-bad",
    warn: "bg-warn-soft text-warn",
    info: "bg-info-soft text-info",
  };
  return <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl [&>svg]:size-5", tones[tone])}>{children}</span>;
}

/** .amz-empty */
export function Empty({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && <IconChip>{icon}</IconChip>}
      <p className="text-[17px] font-bold text-ink">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

/** .amz-alert */
export function Alert({ tone = "info", title, children }: { tone?: "info" | "good" | "warn" | "bad"; title?: string; children?: React.ReactNode }) {
  const cfg = {
    info: { c: "border-info/35 bg-info/10", i: <Info className="text-info" /> },
    good: { c: "border-good/35 bg-good/10", i: <CheckCircle2 className="text-good" /> },
    warn: { c: "border-warn/35 bg-warn/10", i: <AlertTriangle className="text-warn" /> },
    bad: { c: "border-bad/35 bg-bad/10", i: <XCircle className="text-bad" /> },
  }[tone];
  return (
    <div className={cn("mb-4 flex items-start gap-3 rounded-xl border p-4 text-sm text-ink-2 [&>svg]:mt-px [&>svg]:size-[18px] [&>svg]:shrink-0", cfg.c)}>
      {cfg.i}
      <div>
        {title && <div className="mb-0.5 font-bold text-ink">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** .amz-progress */
export function Progress({ value, tone = "brand" }: { value: number; tone?: "brand" | "good" | "bad" }) {
  const bar = { brand: "bg-brand", good: "bg-good", bad: "bg-bad" }[tone];
  return (
    <div className="h-1.5 overflow-hidden rounded-pill bg-line">
      <div className={cn("h-full rounded-pill transition-[width]", bar)} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

/** .amz-avatar */
export function Avatar({ email, tone = "navy" }: { email: string; tone?: "navy" | "gold" }) {
  const initials = email
    .split("@")[0]
    .split(/[._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={cn(
        "inline-grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold",
        tone === "gold" ? "bg-brand text-navy-900" : "bg-navy-500 text-white",
      )}
    >
      {initials || "?"}
    </span>
  );
}

// ── Controls ───────────────────────────────────────────────────────────

const btnBase =
  "inline-flex h-10 items-center justify-center gap-2 rounded-pill border px-5 text-sm leading-none font-bold whitespace-nowrap transition-[background,border-color,color,box-shadow,transform] duration-150 ease-[var(--ease-out)] active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4";

export const buttonClass = {
  /** One amber primary per view. */
  primary: cn(btnBase, "border-transparent bg-brand text-navy-900 hover:bg-brand-hover hover:shadow-gold"),
  navy: cn(btnBase, "border-transparent bg-navy-800 text-white hover:bg-navy-600"),
  secondary: cn(btnBase, "border-line-strong bg-transparent text-ink hover:border-brand hover:text-brand-ink"),
  ghost: cn(btnBase, "border-transparent bg-transparent text-ink-2 hover:bg-canvas hover:text-ink"),
  danger: cn(btnBase, "h-8 border-bad/40 bg-transparent px-4 text-xs text-bad hover:border-bad hover:bg-bad hover:text-white"),
  small: "h-8 px-4 text-xs",
};

export const inputClass =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink transition-[border-color,box-shadow] placeholder:text-faint hover:border-[rgb(0_15_34/0.48)] focus:border-brand focus:shadow-[var(--ring)] focus:outline-none";

export const selectClass = cn(inputClass, "amz-select cursor-pointer");

export const labelClass = "mb-2 block text-sm font-semibold text-ink";

export const linkClass = "text-sm font-semibold text-brand-ink hover:underline hover:underline-offset-[3px]";
