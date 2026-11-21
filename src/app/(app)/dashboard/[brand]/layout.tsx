import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireBrand, requirePerm } from "@/lib/access";
import { BRAND_PAGES } from "@/lib/rbac";

/**
 * Checks the brand and the page's permission before anything streams, so a typed URL to a
 * forbidden brand or page gets a real 404. Each page checks again itself (layouts don't
 * re-run when navigating between pages of the same brand).
 */
export default async function BrandLayout({ children, params }: { children: React.ReactNode; params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  await requireBrand(brand);
  const path = (await headers()).get("x-pathname") ?? "";
  const parts = path.split("/"); // ["", "dashboard", brand, sub?, …]
  if (parts[1] === "dashboard" && parts[2] === brand) {
    const page = BRAND_PAGES.find((p) => p.path === (parts[3] ?? ""));
    if (!page) notFound();
    await requirePerm(page.perm, brand);
  }
  return children;
}
