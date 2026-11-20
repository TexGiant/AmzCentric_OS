"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, Search } from "lucide-react";
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


export function DataTable({
  columns,
  rows,
  defaultSort,
  searchKeys,
  pageSize = 50,
  exportName,
  empty = "No data for this period.",
  footer,
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
}) {
  const [sort, setSort] = useState(defaultSort ?? { key: columns[0].key, dir: "desc" as const });
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(pageSize);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle && searchKeys ? rows.filter((r) => searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(needle))) : rows;
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
  }, [rows, q, sort, searchKeys, columns]);

  const toggle = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const csv = [columns.map((c) => esc(c.label)).join(","), ...[...filtered, ...(footer ? [footer] : [])].map((r) => columns.map((c) => esc(r[c.key])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {(searchKeys || exportName) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5">
          {searchKeys ? (
            <label className="relative w-full max-w-xs">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" strokeWidth={1.5} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="h-10 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-faint hover:border-[rgb(0_15_34/0.48)] focus:border-brand focus:shadow-[var(--ring)] focus:outline-none"
              />
            </label>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3 text-xs text-muted">
            <span>{filtered.length.toLocaleString()} rows</span>
            {exportName && (
              <button onClick={exportCsv} className={cn(buttonClass.secondary, buttonClass.small)}>
                <Download strokeWidth={1.5} /> Export CSV
              </button>
            )}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className={cn("border-b border-line bg-canvas", (searchKeys || exportName) && "border-t")}>
              {columns.map((c, i) => {
                const numeric = c.format && c.format !== "text";
                return (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={cn(
                      "px-4 py-3 text-[11px] font-bold tracking-[0.14em] whitespace-nowrap text-muted uppercase select-none",
                      numeric ? "text-right" : "text-left",
                      i === 0 && "pl-6",
                      i === columns.length - 1 && "pr-6",
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
                {columns.map((c, i) => {
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
                        i === columns.length - 1 && "pr-6",
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
          {footer && filtered.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line-strong bg-canvas font-bold text-ink">
                {columns.map((c, i) => {
                  const numeric = c.format && c.format !== "text";
                  return (
                    <td
                      key={c.key}
                      className={cn("px-4 py-3.5", numeric ? "text-right whitespace-nowrap tabular" : "text-left", c.nowrap && "whitespace-nowrap", i === 0 && "pl-6", i === columns.length - 1 && "pr-6")}
                    >
                      {c.badge ? "" : formatValue(c.format ?? "text", footer[c.key])}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {filtered.length === 0 && <div className="px-6 py-12 text-center text-sm text-muted">{empty}</div>}
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
