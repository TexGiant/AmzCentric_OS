export type Totals = {
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
  units: number;
  totalSales?: number | null;
  /** SP-API (all orders, ads + organic). Null until Seller Central is connected. */
  totalOrders?: number | null;
};

export const ZERO: Totals = { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, units: 0, totalSales: null, totalOrders: null };

export function sum<T extends Partial<Totals>>(rows: T[]): Totals {
  const t: Totals = { ...ZERO };
  let total: number | null = null;
  let totalOrders: number | null = null;
  for (const r of rows) {
    t.impressions += Number(r.impressions ?? 0);
    t.clicks += Number(r.clicks ?? 0);
    t.cost += Number(r.cost ?? 0);
    t.sales += Number(r.sales ?? 0);
    t.orders += Number(r.orders ?? 0);
    t.units += Number(r.units ?? 0);
    if (r.totalSales != null) total = (total ?? 0) + Number(r.totalSales);
    if (r.totalOrders != null) totalOrders = (totalOrders ?? 0) + Number(r.totalOrders);
  }
  t.totalSales = total;
  t.totalOrders = totalOrders;
  return t;
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);

export const acos = (t: Totals) => div(t.cost, t.sales);
export const roas = (t: Totals) => div(t.sales, t.cost);
export const ctr = (t: Totals) => div(t.clicks, t.impressions);
export const cpc = (t: Totals) => div(t.cost, t.clicks);
export const cvr = (t: Totals) => div(t.orders, t.clicks);
export const aov = (t: Totals) => div(t.sales, t.orders);
export const tacos = (t: Totals) => (t.totalSales ? div(t.cost, t.totalSales) : null);

export function change(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

/** Adds derived ratios to a row so tables can sort on them. */
export function withRatios<T extends Totals>(r: T) {
  return { ...r, acos: acos(r), roas: roas(r), ctr: ctr(r), cpc: cpc(r), cvr: cvr(r) };
}
