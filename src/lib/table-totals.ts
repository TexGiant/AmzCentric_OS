import type { TotalsSpec } from "@/components/data-table";

/*
 * Totals rows for the ad tables. Counts and money are added up; percentages are blended
 * (total ACOS = total spend ÷ total sales, as Amazon reports a total), and Δ columns compare
 * the total with the same total for the prior period (rows carry salesPrev / costPrev).
 */
export const AD_TOTALS: TotalsSpec = {
  sum: ["impressions", "clicks", "cost", "orders", "units", "sales", "budget", "totalSales", "avgClicks", "avgSales", "salesPrev", "salesNow", "salesChange", "costChange"],
  ratio: {
    acos: ["cost", "sales"],
    acosNow: ["costNow", "salesNow"],
    tacos: ["cost", "totalSales"],
    cvr: ["orders", "clicks"],
    ctr: ["clicks", "impressions"],
    cpc: ["cost", "clicks"],
    roas: ["sales", "cost"],
  },
  change: {
    salesDelta: { now: ["sales"], prev: ["salesPrev"] },
    acosDelta: { now: ["cost", "sales"], prev: ["costPrev", "salesPrev"] },
  },
};

/** What Changed tables compare "now" with "before" columns. */
export const MOVER_TOTALS: TotalsSpec = {
  ...AD_TOTALS,
  change: { salesDelta: { now: ["salesNow"], prev: ["salesPrev"] } },
};
