"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Columns3, Download, Search, SlidersHorizontal, X } from "lucide-react";
import { logExport } from "@/app/export-actions";
import { formatValue, type FormatKind } from "@/lib/format";
import { badgeClass, buttonClass, cn, type Tone } from "@/components/ui";

export type Column = {
  key: string;
  label: string;
  format?: FormatKind;
  /** Color deltas: "up" means higher is good, "down" means lower is good. */
  tone?: "up" | "down";
  width?: string;
  /** Render values as .amz-badge — maps value → tone (good | bad | warn | brand | info | neutral). */
  badge?: Record<string, string>;
  badgeDot?: boolean;
  /** Small tag under the header label, e.g. the data source ("SP-API"). */
  tag?: string;
  /** Sort by another field (e.g. an ISO date behind a display label). */
  sortKey?: string;
  /** Keep the cell on one line (dates, short labels). */
  nowrap?: boolean;
};

type Row = Record<string, unknown>;

/**
 * A totals row computed from the rows currently shown (so it follows the search box).
 * Percent columns are blended, not averaged: total ACOS = total spend ÷ total sales, the way
 * Amazon reports a total. Δ columns compare the totals with the same totals for the prior period.
 */
export type TotalsSpec = {
  label?: string;
  /** Columns to add up. */
  sum?: string[];
  /** column → [numerator, denominator], both summed over the rows. */
  ratio?: Record<string, [string, string]>;
  /** column → change of a summed value (or ratio) now vs prior: { now: [num, den?], prev: [num, den?] }. */
  change?: Record<string, { now: [string, string?]; prev: [string, string?] }>;
  /** Values that must be present on every row (e.g. SP-API figures); otherwise the total is left empty. */
  strict?: string[];
};

// ── Filters ─────────────────────────────────────────────────────────────

type Filter = { kind: "range"; min: string; max: string } | { kind: "set"; values: string[] };
const NUMERIC = new Set(["int", "money", "money2", "pct", "delta", "ratio", "dec1"]);
const PERCENT = new Set(["pct", "delta"]);
const isNumeric = (c: Column) => !!c.format && NUMERIC.has(c.format);
/** Percent columns are typed as percents (30 = 30%) and stored as fractions. */
const toValue = (c: Column, raw: string) => {
  const n = Number(raw.replace(/[$,%\s]/g, ""));
  if (raw.trim() === "" || !Number.isFinite(n)) return null;
  return PERCENT.has(c.format ?? "") ? n / 100 : n;
};
const unit = (c: Column) => (PERCENT.has(c.format ?? "") ? "%" : c.format?.startsWith("money") ? "$" : "");

function passes(r: Row, c: Column, f: Filter): boolean {
  const v = r[c.key];
  if (f.kind === "set") return f.values.length === 0 || f.values.includes(String(v ?? "—"));
  const min = toValue(c, f.min);
  const max = toValue(c, f.max);
  if (min == null && max == null) return true;
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  // Small tolerance so "ACOS ≤ 30%" keeps a row showing 30.0%.
  return (min == null || v >= min - 1e-9) && (max == null || v <= max + 1e-9);
}

function describe(c: Column, f: Filter): string {
  if (f.kind === "set") return `${c.label}: ${f.values.join(", ")}`;
  const u = unit(c);
  const fmt = (x: string) => (u === "$" ? `$${x}` : u === "%" ? `${x}%` : x);
  if (f.min && f.max) return f.min === f.max ? `${c.label} = ${fmt(f.min)}` : `${c.label} ${fmt(f.min)}–${fmt(f.max)}`;
  return f.min ? `${c.label} ≥ ${fmt(f.min)}` : `${c.label} ≤ ${fmt(f.max)}`;
}

const active = (f: Filter | undefined) => !!f && (f.kind === "set" ? f.values.length > 0 : f.min.trim() !== "" || f.max.trim() !== "");

function computeTotals(rows: Row[], spec: TotalsSpec): Row {
  const keys = new Set<string>(spec.sum ?? []);
  for (const [a, b] of Object.values(spec.ratio ?? {})) keys.add(a).add(b);
  for (const c of Object.values(spec.change ?? {})) [...c.now, ...c.prev].forEach((k) => k && keys.add(k));
  const tot: Record<string, number | null> = {};
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  for (const k of keys) {
    const vals = rows.map((r) => r[k]);
    const present = vals.filter(num);
    // Nothing to add up, or a strict value missing on some row → no total.
    tot[k] = present.length === 0 || (spec.strict?.includes(k) && present.length !== vals.length) ? null : present.reduce((a, v) => a + v, 0);
  }
  const val = ([n, d]: [string, string?]) => {
    const a = tot[n];
    if (!d) return a;
    const b = tot[d];
    return a == null || b == null || b <= 0 ? null : a / b;
  };
  const out: Row = {};
  for (const k of spec.sum ?? []) out[k] = tot[k];
  for (const [k, pair] of Object.entries(spec.ratio ?? {})) out[k] = val(pair);
  for (const [k, c] of Object.entries(spec.change ?? {})) {
    const now = val(c.now);
    const prev = val(c.prev);
    out[k] = now == null || prev == null || prev === 0 ? null : (now - prev) / Math.abs(prev);
  }
  return out;
}


/** Totals cell: deltas keep their colour; blank for columns with nothing to total. */
function footerCell(c: Column, v: unknown) {
  if (v === undefined) return "";
  const text = formatValue(c.format ?? "text", v);
  if (c.format === "delta" && typeof v === "number" && Number.isFinite(v) && c.tone) {
    const good = c.tone === "up" ? v > 0 : v < 0;
    return <span className={Math.abs(v) < 0.005 ? "text-muted" : good ? "text-good" : "text-bad"}>{text}</span>;
  }
  return text;
}

export function DataTable({
  columns,
  rows,
  defaultSort,
  searchKeys,
  pageSize = 50,
  exportName,
  empty = "No data for this period.",
  footer,
  totals,
}: {
  columns: Column[];
  rows: Row[];
  defaultSort?: { key: string; dir: "asc" | "desc" };
  searchKeys?: string[];
  pageSize?: number;
  exportName?: string;
  empty?: string;
  /** A totals row pinned under the rows (not sorted, included in CSV). */
  footer?: Row;
  /** Or have the table compute the totals row from the visible rows. */
  totals?: TotalsSpec;
}) {
  const [sort, setSort] = useState(defaultSort ?? { key: columns[0].key, dir: "desc" as const });
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const [filters, setFilters] = useState<Record<string, Filter>>({});
  const [panel, setPanel] = useState<null | "filters" | "columns">(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const toolbar = !!(searchKeys || exportName);

  // Hidden columns are remembered per table (same table on every brand), in this browser only.
  const storeKey = useMemo(() => `amz-cols:${columns.map((c) => c.key).join(",")}`, [columns]);
  useEffect(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem(storeKey) ?? "[]");
      if (Array.isArray(v)) setHidden(v.filter((k) => typeof k === "string"));
    } catch {
      /* storage unavailable */
    }
  }, [storeKey]);
  const setHiddenAndSave = (next: string[]) => {
    setHidden(next);
    try {
      window.localStorage.setItem(storeKey, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  const shown = columns.filter((c, i) => i === 0 || !hidden.includes(c.key));

  // Text columns with a handful of values (Type, State, Match, Driver…) filter by pick-list.
  const choices = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of columns) {
      // Numbers get ranges; columns the search box already covers (names, IDs) aren't pick-lists.
      if (isNumeric(c) || (!c.badge && searchKeys?.includes(c.key))) continue;
      const vals = [...new Set(rows.map((r) => String(r[c.key] ?? "—")))];
      if (c.badge ? vals.length >= 1 : vals.length >= 2 && vals.length <= 15) out[c.key] = vals.sort();
    }
    return out;
  }, [columns, rows, searchKeys]);
  const filterCols = columns.filter((c) => isNumeric(c) || choices[c.key]);
  const activeFilters = Object.entries(filters).filter(([, f]) => active(f));

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const searched = needle && searchKeys ? rows.filter((r) => searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(needle))) : rows;
    const on = Object.entries(filters).filter(([, f]) => active(f));
    const base = on.length
      ? searched.filter((r) => on.every(([k, f]) => {
          const c = columns.find((x) => x.key === k);
          return !c || passes(r, c, f);
        }))
      : searched;
    const sorted = [...base].sort((a, b) => {
      const sk = columns.find((c) => c.key === sort.key)?.sortKey ?? sort.key;
      const av = a[sk];
      const bv = b[sk];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, q, sort, searchKeys, columns, filters]);

  const totalsRow = useMemo<Row | undefined>(() => {
    if (footer || !totals) return footer;
    const t = computeTotals(filtered, totals);
    t[columns[0].key] = `${totals.label ?? "Total"} · ${filtered.length.toLocaleString()} ${filtered.length === 1 ? "row" : "rows"}`;
    return t;
  }, [footer, totals, filtered, columns]);

  const toggle = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  const exportCsv = async () => {
    // Recorded in the audit log; refused when the page's brand isn't one this person can see.
    const ok = await logExport(exportName ?? "export", filtered.length, window.location.pathname).catch(() => false);
    if (!ok) return;
    const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const csv = [shown.map((c) => esc(c.label)).join(","), ...[...filtered, ...(totalsRow ? [totalsRow] : [])].map((r) => shown.map((c) => esc(r[c.key])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {toolbar && (
        <div className="border-b border-line">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5">
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {searchKeys && (
                <label className="relative w-full sm:w-72">
                  <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" strokeWidth={1.5} />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search…"
                    className="h-10 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-faint hover:border-[rgb(0_15_34/0.48)] focus:border-brand focus:shadow-[var(--ring)] focus:outline-none"
                  />
                </label>
              )}
              {filterCols.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPanel((p) => (p === "filters" ? null : "filters"))}
                  aria-expanded={panel === "filters"}
                  className={cn(buttonClass.secondary, buttonClass.small, (panel === "filters" || activeFilters.length > 0) && "border-brand text-brand-ink")}
                >
                  <SlidersHorizontal strokeWidth={1.75} /> Filters
                  {activeFilters.length > 0 && <span className="rounded-pill bg-brand px-1.5 text-[11px] font-bold text-navy-900">{activeFilters.length}</span>}
                </button>
              )}
              <button
                type="button"
                onClick={() => setPanel((p) => (p === "columns" ? null : "columns"))}
                aria-expanded={panel === "columns"}
                className={cn(buttonClass.ghost, buttonClass.small, hidden.length > 0 && "text-brand-ink")}
              >
                <Columns3 strokeWidth={1.75} /> Columns{hidden.length > 0 ? ` (${columns.length - hidden.length}/${columns.length})` : ""}
              </button>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted">
              <span>
                {filtered.length !== rows.length ? `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} rows` : `${rows.length.toLocaleString()} rows`}
              </span>
              {exportName && (
                <button onClick={exportCsv} className={cn(buttonClass.secondary, buttonClass.small)}>
                  <Download strokeWidth={1.5} /> Export CSV
                </button>
              )}
            </div>
          </div>

          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-6 pb-3.5">
              {activeFilters.map(([k, f]) => {
                const c = columns.find((x) => x.key === k)!;
                return (
                  <span key={k} className="inline-flex h-7 items-center gap-1 rounded-pill bg-gold-100 pr-1.5 pl-3 text-xs font-semibold text-gold-800">
                    {describe(c, f)}
                    <button
                      type="button"
                      aria-label={`Remove ${c.label} filter`}
                      onClick={() => setFilters(({ [k]: _drop, ...rest }) => rest)}
                      className="rounded-full p-0.5 hover:bg-gold-200"
                    >
                      <X className="size-3" strokeWidth={2.5} />
                    </button>
                  </span>
                );
              })}
              <button type="button" onClick={() => setFilters({})} className="text-xs font-semibold text-muted hover:text-ink hover:underline">
                Clear all
              </button>
            </div>
          )}

          {panel === "filters" && (
            <div className="grid gap-x-5 gap-y-4 border-t border-line bg-canvas/60 px-6 py-5 sm:grid-cols-2 lg:grid-cols-4">
              {filterCols.map((c) => {
                const f = filters[c.key];
                if (choices[c.key]) {
                  const sel = f?.kind === "set" ? f.values : [];
                  return (
                    <div key={c.key}>
                      <div className="mb-1.5 text-xs font-bold text-ink">{c.label}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {choices[c.key].map((v) => {
                          const on = sel.includes(v);
                          return (
                            <button
                              key={v}
                              type="button"
                              aria-pressed={on}
                              onClick={() =>
                                setFilters((cur) => ({ ...cur, [c.key]: { kind: "set", values: on ? sel.filter((x) => x !== v) : [...sel, v] } }))
                              }
                              className={cn(
                                "h-7 rounded-pill border px-2.5 text-xs font-semibold transition-colors",
                                on ? "border-brand bg-brand text-navy-900" : "border-line-strong bg-surface text-ink-2 hover:border-brand",
                              )}
                            >
                              {v}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                const r = f?.kind === "range" ? f : { kind: "range" as const, min: "", max: "" };
                const set = (part: "min" | "max", v: string) => setFilters((cur) => ({ ...cur, [c.key]: { ...r, [part]: v } }));
                const u = unit(c);
                return (
                  <div key={c.key}>
                    <div className="mb-1.5 text-xs font-bold text-ink">
                      {c.label}
                      {u && <span className="ml-1 font-normal text-muted">({u})</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        inputMode="decimal"
                        aria-label={`${c.label} minimum`}
                        placeholder="Min"
                        value={r.min}
                        onChange={(e) => set("min", e.target.value)}
                        className="h-8 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-2.5 text-xs text-ink tabular placeholder:text-faint focus:border-brand focus:outline-none"
                      />
                      <span className="text-xs text-faint">–</span>
                      <input
                        inputMode="decimal"
                        aria-label={`${c.label} maximum`}
                        placeholder="Max"
                        value={r.max}
                        onChange={(e) => set("max", e.target.value)}
                        className="h-8 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-2.5 text-xs text-ink tabular placeholder:text-faint focus:border-brand focus:outline-none"
                      />
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted sm:col-span-2 lg:col-span-4">
                Percent columns take percents (30 = 30%). Set min and max to the same number for an exact value (Orders 0–0 = no orders). Totals and CSV export follow the filters.
              </p>
            </div>
          )}

          {panel === "columns" && (
            <div className="flex flex-wrap gap-x-5 gap-y-2.5 border-t border-line bg-canvas/60 px-6 py-4">
              {columns.map((c, i) => (
                <label key={c.key} className={cn("flex items-center gap-2 text-sm", i === 0 && "opacity-60")}>
                  <input
                    type="checkbox"
                    disabled={i === 0}
                    checked={i === 0 || !hidden.includes(c.key)}
                    onChange={(e) => setHiddenAndSave(e.target.checked ? hidden.filter((k) => k !== c.key) : [...hidden, c.key])}
                    className="size-4 accent-[#f8a42e]"
                  />
                  {c.label}
                </label>
              ))}
              {hidden.length > 0 && (
                <button type="button" onClick={() => setHiddenAndSave([])} className="text-xs font-semibold text-brand-ink hover:underline">
                  Show all
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line bg-canvas">
              {shown.map((c, i) => {
                const numeric = c.format && c.format !== "text";
                return (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={cn(
                      "px-4 py-3 text-[11px] font-bold tracking-[0.14em] whitespace-nowrap text-muted uppercase select-none",
                      numeric ? "text-right" : "text-left",
                      i === 0 && "pl-6",
                      i === shown.length - 1 && "pr-6",
                    )}
                  >
                    <button onClick={() => toggle(c.key)} className={cn("inline-flex items-center gap-1 hover:text-ink", numeric && "flex-row-reverse")}>
                      {c.tag ? (
                        <span className={cn("flex flex-col gap-1", numeric ? "items-end" : "items-start")}>
                          {c.label}
                          <span className="rounded-pill bg-[#f1f5f9] px-1.5 py-px text-[9px] font-bold tracking-[0.08em] text-faint">{c.tag}</span>
                        </span>
                      ) : (
                        c.label
                      )}
                      {sort.key === c.key &&
                        (sort.dir === "asc" ? <ArrowUp className="size-3" strokeWidth={2} /> : <ArrowDown className="size-3" strokeWidth={2} />)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((r, ri) => (
              <tr key={ri} className="border-b border-line transition-colors last:border-0 hover:bg-canvas">
                {shown.map((c, i) => {
                  const v = r[c.key];
                  const numeric = c.format && c.format !== "text";
                  let tone = "";
                  if (c.format === "delta" && typeof v === "number" && Number.isFinite(v) && c.tone) {
                    const good = c.tone === "up" ? v > 0 : v < 0;
                    tone = Math.abs(v) < 0.005 ? "text-muted" : good ? "text-good" : "text-bad";
                  }
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "px-4 py-3.5 align-middle",
                        numeric ? "text-right whitespace-nowrap tabular" : "text-left",
                        c.nowrap && "whitespace-nowrap",
                        i === 0 && "pl-6 font-semibold text-ink",
                        i === shown.length - 1 && "pr-6",
                        tone || (i === 0 ? "" : "text-ink-2"),
                      )}
                    >
                      {c.badge && v != null ? (
                        <span className={badgeClass((c.badge[String(v)] ?? "neutral") as Tone)}>
                          {(c.badgeDot ?? true) && <span className="size-1.5 rounded-full bg-current" />}
                          {String(v)}
                        </span>
                      ) : (
                        formatValue(c.format ?? "text", v)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {totalsRow && filtered.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line-strong bg-canvas font-bold text-ink">
                {shown.map((c, i) => {
                  const numeric = c.format && c.format !== "text";
                  return (
                    <td
                      key={c.key}
                      className={cn("px-4 py-3.5", numeric ? "text-right whitespace-nowrap tabular" : "text-left", c.nowrap && "whitespace-nowrap", i === 0 && "pl-6", i === shown.length - 1 && "pr-6")}
                    >
                      {c.badge ? "" : footerCell(c, totalsRow[c.key])}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {filtered.length === 0 && <div className="px-6 py-12 text-center text-sm text-muted">{rows.length > 0 ? "No rows match your search or filters." : empty}</div>}
      {filtered.length > limit && (
        <div className="flex items-center justify-between border-t border-line px-6 py-3.5">
          <span className="text-xs text-muted">
            Showing 1–{limit} of {filtered.length.toLocaleString()}
          </span>
          <button onClick={() => setLimit((l) => l + pageSize * 2)} className={cn(buttonClass.ghost, buttonClass.small, "text-brand-ink")}>
            Show more ({(filtered.length - limit).toLocaleString()} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
