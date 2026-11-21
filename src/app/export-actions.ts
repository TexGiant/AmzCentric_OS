"use server";

import { getAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { canSeeBrand } from "@/lib/rbac";

/**
 * Called when someone exports a table to CSV. The rows were already filtered by the server for
 * this person; this records the export (and flags one from a page they can't see).
 * Returns false when the export should not go ahead.
 */
export async function logExport(name: string, rows: number, path: string): Promise<boolean> {
  const a = await getAccess();
  if (!a) return false;
  const brand = path.match(/^\/dashboard\/([^/?#]+)/)?.[1] ?? null;
  if (brand && !canSeeBrand(a, brand)) {
    await audit({ action: "access.denied", actor: a, brand, target: `export:${name}` });
    return false;
  }
  await audit({ action: "export.csv", actor: a, brand, target: name.slice(0, 200), detail: { rows, page: path.slice(0, 200) } });
  return true;
}
