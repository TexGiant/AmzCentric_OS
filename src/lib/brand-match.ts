import type { Brand } from "@/lib/data/types";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Finds a brand by slug or name ("mr-assist", "Mr. Assist", "assist"). */
export function matchBrand(brands: Brand[], input: string): { brand: Brand | null; candidates: Brand[] } {
  const q = input.trim().toLowerCase();
  if (!q) return { brand: null, candidates: [] };
  const exact = brands.find((b) => b.slug === q || b.name.toLowerCase() === q || norm(b.name) === norm(q));
  if (exact) return { brand: exact, candidates: [exact] };
  const partial = brands.filter((b) => b.slug.includes(q) || b.name.toLowerCase().includes(q) || norm(b.name).includes(norm(q)));
  return { brand: partial.length === 1 ? partial[0] : null, candidates: partial };
}

/** The one brand whose name or slug appears in a meeting title or text, if exactly one does. */
export function detectBrand(brands: Brand[], text: string): Brand | null {
  const t = ` ${norm(text)} `;
  const hits = brands.filter((b) => t.includes(` ${norm(b.name)} `) || t.includes(` ${norm(b.slug)} `));
  return hits.length === 1 ? hits[0] : null;
}
