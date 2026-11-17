import "server-only";
import { notFound } from "next/navigation";
import { data } from "@/lib/data";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export type BrandParams = Promise<{ brand: string }>;

export function param(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export async function getBrandOr404(slug: string) {
  const brands = await data().listBrands();
  const brand = brands.find((b) => b.slug === slug);
  if (!brand) notFound();
  return brand;
}
