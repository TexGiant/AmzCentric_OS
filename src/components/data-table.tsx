"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, Search } from "lucide-react";
import { formatValue, type FormatKind } from "@/lib/format";
import { cn } from "@/components/ui";

export type Column = {
  key: string;
  label: string;
  format?: FormatKind;
  /** Color deltas: "up" means higher is good, "down" means lower is good. */
  tone?: "up" | "down";
  width?: string;
  badge?: Record<string, string>;
};

type Row = Record<string, unknown>;

const BADGE_TONES: Record<string, string> = {
  good: "bg-good-soft text-good",
  bad: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn",
  brand: "bg-brand-soft text-brand",
  neutral: "bg-canvas text-muted",
};

export function DataTable({
  columns,
  rows,
  defaultSort,
  searchKeys,
  pageSize = 50,
  exportName,
  empty = "No data for this period.",
}: {
  columns: Column[];
  rows: Row[];
  defaultSort?: { key: string; dir: "asc" | "desc" };
  searchKeys?: string[];
  pageSize?: number;
  exportName?: string;
  empty?: string;
}) {
  const [sort, setSort] = useState(defaultSort ?? { key: columns[0].key, dir: "desc" as const });
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(pageSize);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle && searchKeys ? rows.filter((r) => searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(needle))) : rows;
    const sorted = [...base].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, q, sort, searchKeys]);

  const toggle = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const csv = [columns.map((c) => esc(c.label)).join(","), ...filtered.map((r) => columns.map((c) => esc(r[c.key])).join(","))].join("\n");
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
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
          {searchKeys ? (
            <label className="relative w-full max-w-xs">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" strokeWidth={1.5} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full rounded-xl border border-line bg-canvas py-2 pr-3 pl-9 text-sm focus:border-brand focus:bg-surface focus:outline-none"
              />
            </label>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3 text-xs text-muted">
            <span>{filtered.length.toLocaleString()} rows</span>
            {exportName && (
              <button onClick={exportCsv} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-ink-2 hover:bg-canvas">
                <Download className="size-3.5" strokeWidth={1.5} /> CSV
              </button>
            )}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-y border-line bg-canvas/60">
              {columns.map((c, i) => {
                const numeric = c.format && c.format !== "text";
                return (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={cn(
                      "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap text-muted select-none",
                      numeric ? "text-right" : "text-left",
                      i === 0 && "pl-5",
                      i === columns.length - 1 && "pr-5",
                    )}
                  >
                    <button onClick={() => toggle(c.key)} className={cn("inline-flex items-center gap-1 hover:text-ink", numeric && "flex-row-reverse")}>
                      {c.label}
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
              <tr key={ri} className="border-b border-line/70 last:border-0 hover:bg-canvas/50">
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
                        "px-3 py-2.5 align-top",
                        numeric ? "text-right whitespace-nowrap tabular" : "text-left",
                        i === 0 && "pl-5 font-medium text-ink",
                        i === columns.length - 1 && "pr-5",
                        tone || (i === 0 ? "" : "text-ink-2"),
                      )}
                    >
                      {c.badge && v != null ? (
                        <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", BADGE_TONES[c.badge[String(v)] ?? "neutral"])}>
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
        </table>
      </div>
      {filtered.length === 0 && <div className="px-5 py-10 text-center text-sm text-muted">{empty}</div>}
      {filtered.length > limit && (
        <div className="border-t border-line px-5 py-3 text-center">
          <button onClick={() => setLimit((l) => l + pageSize * 2)} className="text-sm font-medium text-brand hover:underline">
            Show more ({(filtered.length - limit).toLocaleString()} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
