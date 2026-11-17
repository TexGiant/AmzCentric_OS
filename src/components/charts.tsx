"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS = { fontSize: 11, fill: "#94a3b8" };
const GRID = "#eef0f5";

const money = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`);
const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

type TooltipRow = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number };

function ChartTooltip({
  active,
  payload,
  label,
  labelFormat,
  valueFormat,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: string | number;
  labelFormat?: (l: string) => string;
  valueFormat: (key: string, v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg shadow-ink/5">
      <div className="mb-1 font-medium text-ink">{labelFormat ? labelFormat(String(label)) : label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-ink-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="flex-1">{p.name}</span>
          <span className="font-medium tabular">{valueFormat(String(p.dataKey), Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-3 rounded-sm"
            style={i.dashed ? { borderTop: `2px dashed ${i.color}`, height: 0 } : { background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Sales area + spend bars over time. */
export function SalesSpendChart({
  data,
  salesKey = "sales",
  salesLabel = "Ad sales",
  markers = [],
}: {
  data: Array<{ date: string; sales: number; cost: number; totalSales?: number | null }>;
  salesKey?: "sales" | "totalSales";
  salesLabel?: string;
  markers?: Array<{ date: string; label: string }>;
}) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-series-sales)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--color-series-sales)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis yAxisId="s" tickFormatter={money} tick={AXIS} axisLine={false} tickLine={false} width={48} />
          <YAxis yAxisId="c" orientation="right" hide domain={[0, (max: number) => max * 2.6]} />
          <Tooltip
            cursor={{ fill: "rgba(36,71,214,0.05)" }}
            content={<ChartTooltip labelFormat={shortDate} valueFormat={(_, v) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />}
          />
          <Bar yAxisId="c" dataKey="cost" name="Ad spend" fill="var(--color-series-spend)" radius={[3, 3, 0, 0]} maxBarSize={14} />
          <Area
            yAxisId="s"
            dataKey={salesKey}
            name={salesLabel}
            type="monotone"
            stroke="var(--color-series-sales)"
            strokeWidth={2}
            fill="url(#salesFill)"
          />
          {markers.map((m) => (
            <ReferenceLine
              key={m.date + m.label}
              yAxisId="s"
              x={m.date}
              stroke="#0f172a"
              strokeDasharray="3 3"
              label={{ value: m.label, position: "insideTopLeft", fontSize: 10, fill: "#334155" }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** ACOS / TACOS / CVR lines over time (percent axis). */
export function RatioChart({
  data,
  series,
  markers = [],
}: {
  data: Array<Record<string, number | string | null>>;
  series: Array<{ key: string; label: string; color: string }>;
  markers?: Array<{ date: string; label: string }>;
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={AXIS} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<ChartTooltip labelFormat={shortDate} valueFormat={(_, v) => `${(v * 100).toFixed(1)}%`} />} />
          {series.map((s) => (
            <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} type="monotone" connectNulls />
          ))}
          {markers.map((m) => (
            <ReferenceLine key={m.date + m.label} x={m.date} stroke="#0f172a" strokeDasharray="3 3" />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Hourly bars for one day plus the trailing 7-day average line. */
export function HourlyChart({ data }: { data: Array<{ hour: number; cost: number; sales: number; avgSales: number }> }) {
  const hourLabel = (h: number | string) => {
    const n = Number(h);
    return n === 0 ? "12a" : n < 12 ? `${n}a` : n === 12 ? "12p" : `${n - 12}p`;
  };
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="hour" tickFormatter={hourLabel} tick={AXIS} axisLine={false} tickLine={false} interval={1} />
          <YAxis tickFormatter={money} tick={AXIS} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            cursor={{ fill: "rgba(36,71,214,0.05)" }}
            content={<ChartTooltip labelFormat={(l) => hourLabel(l)} valueFormat={(_, v) => `$${v.toFixed(2)}`} />}
          />
          <Bar dataKey="sales" name="Sales" fill="var(--color-series-sales)" radius={[3, 3, 0, 0]} maxBarSize={16} />
          <Bar dataKey="cost" name="Spend" fill="var(--color-series-spend)" radius={[3, 3, 0, 0]} maxBarSize={16} />
          <Line dataKey="avgSales" name="7-day avg sales" stroke="#0f172a" strokeDasharray="4 3" strokeWidth={1.5} dot={false} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cumulative actual vs straight-line target across the month. */
export function PaceChart({ data }: { data: Array<{ date: string; actual: number | null; target: number; projected: number | null }> }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-series-sales)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--color-series-sales)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis tickFormatter={money} tick={AXIS} axisLine={false} tickLine={false} width={52} />
          <Tooltip content={<ChartTooltip labelFormat={shortDate} valueFormat={(_, v) => `$${Math.round(v).toLocaleString("en-US")}`} />} />
          <Line dataKey="target" name="Target pace" stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
          <Area dataKey="actual" name="Actual" stroke="var(--color-series-sales)" strokeWidth={2} fill="url(#paceFill)" connectNulls={false} />
          <Line dataKey="projected" name="Projected" stroke="var(--color-series-sales)" strokeDasharray="2 4" strokeWidth={2} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
