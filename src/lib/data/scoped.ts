import "server-only";
import { AccessDenied } from "@/lib/access";
import { can, canSeeBrand, visibleBrands, type Access } from "@/lib/rbac";
import type { DataSource } from "@/lib/data/types";

/**
 * Wraps a data source with the person's access: brand lists are filtered, and reading a
 * brand they can't see throws. In production this sits on top of the database's own RLS,
 * so an app bug still can't leak another brand.
 */
export function scopedSource(ds: DataSource, getAccess: () => Promise<Access | null>): DataSource {
  const guard = async (brand: string) => {
    const a = await getAccess();
    if (!canSeeBrand(a, brand)) throw new AccessDenied(`No access to brand ${brand}`);
    return a;
  };
  return {
    async listBrands() {
      return visibleBrands(await getAccess(), await ds.listBrands());
    },
    async brandStatus(brand) {
      await guard(brand);
      return ds.brandStatus(brand);
    },
    async brandDaily(brand, from, to) {
      await guard(brand);
      return ds.brandDaily(brand, from, to);
    },
    async campaigns(brand, from, to) {
      await guard(brand);
      return ds.campaigns(brand, from, to);
    },
    async searchTerms(brand, from, to) {
      await guard(brand);
      return ds.searchTerms(brand, from, to);
    },
    async products(brand, from, to) {
      await guard(brand);
      return ds.products(brand, from, to);
    },
    async hourly(brand, day) {
      await guard(brand);
      return ds.hourly(brand, day);
    },
    async window(brand, campaignId, from, to) {
      await guard(brand);
      return ds.window(brand, campaignId, from, to);
    },
    async actions(brand, limit) {
      await guard(brand);
      return ds.actions(brand, limit);
    },
    async goal(brand, month) {
      const a = await guard(brand);
      // Goals are for brand managers and admins; others just don't get pacing.
      return can(a, "goals.view", brand) ? ds.goal(brand, month) : null;
    },
  };
}
