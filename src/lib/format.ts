export function money(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function int(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
}

export function compact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export type FormatKind = "money" | "money2" | "pct" | "int" | "text" | "delta" | "ratio" | "dec1";

export function formatValue(kind: FormatKind, v: unknown): string {
  if (kind === "text") return v == null || v === "" ? "—" : String(v);
  const n = typeof v === "number" ? v : v == null ? null : Number(v);
  switch (kind) {
    case "money":
      return money(n);
    case "money2":
      return money(n, 2);
    case "pct":
      return pct(n);
    case "delta":
      return n == null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
    case "dec1":
      return n == null || !Number.isFinite(n) ? "—" : n.toFixed(1);
    case "ratio":
      return n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(2)}x`;
    default:
      return int(n);
  }
}
