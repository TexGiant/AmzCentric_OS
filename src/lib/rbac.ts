/*
 * Role-based access for AmzCentric OS. Pure (no server imports) so the sidebar, server
 * guards and the Claude connector all read the same rules.
 *
 * Default deny: a permission no role lists is granted to nobody, admins included.
 * Brands: admins see every brand; everyone else sees only the brands assigned to them.
 */

import type { ActionCategory } from "@/lib/data/types";

export const ROLES = ["admin", "brand_manager", "ppc_manager", "catalog_manager"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  brand_manager: "Brand manager",
  ppc_manager: "PPC manager",
  catalog_manager: "Catalog manager",
};

export const PERMS = [
  "overview",
  "what_changed",
  "reports",
  "goals.view",
  "goals.edit",
  "meetings.view",
  "meetings.edit",
  "tasks.view", // own + assigned tasks
  "tasks.team", // every task on their brands; assign to their team
  "actions.view",
  "actions.log", // log listing / pricing actions
  "actions.log_all", // log any category (bids, budgets, negatives, …)
  "campaigns",
  "search_terms",
  "hourly",
  "products",
  // Admin areas
  "settings", // Team, Brands, Connections, Data Sync, Meeting capture
  "audit_log",
  "connector_admin", // see / disconnect everyone's Claude connections
  "leads", // future Leads / Audits / Sales / Marketing areas
  // Defined now, granted to nobody yet.
  "catalog_inventory", // SP-API inventory
  "campaign_edit", // changing campaigns from the app (later: PPC + Brand managers, with approval)
] as const;
export type Perm = (typeof PERMS)[number];

/** Never granted until the feature ships. */
const UNGRANTED: Perm[] = ["catalog_inventory", "campaign_edit"];

export const ROLE_PERMS: Record<Role, Perm[]> = {
  admin: PERMS.filter((p) => !UNGRANTED.includes(p)),
  brand_manager: [
    "overview",
    "what_changed",
    "reports",
    "goals.view",
    "goals.edit",
    "meetings.view",
    "meetings.edit",
    "tasks.view",
    "tasks.team",
    "actions.view",
    "actions.log",
    "actions.log_all",
    "campaigns",
    "search_terms",
    "hourly",
    "products",
  ],
  ppc_manager: [
    "overview",
    "campaigns",
    "search_terms",
    "hourly",
    "products",
    "reports",
    "actions.view",
    "actions.log",
    "actions.log_all",
    "tasks.view",
    "meetings.view",
  ],
  catalog_manager: ["overview", "products", "reports", "actions.view", "actions.log", "tasks.view", "meetings.view"],
};

/** Action Log categories a catalog manager may log (coupons are logged under "pricing"). */
export const CATALOG_ACTION_CATEGORIES: ActionCategory[] = ["listing", "pricing"];

export type Access = {
  userId: string;
  email: string;
  roles: Role[];
  /** Roles held at "junior" level — reserved for the future approval flow. */
  juniorRoles: Role[];
  /** Brand slugs assigned to this person (ignored for admins, who see all). */
  brands: string[];
  reportsTo: string | null;
  /** Direct reports (people whose "reports to" is this person). */
  team: Array<{ userId: string; email: string }>;
};

export const isAdmin = (a: Access | null | undefined) => !!a?.roles.includes("admin");

export function permsOf(a: Access | null | undefined): Set<Perm> {
  const out = new Set<Perm>();
  for (const r of a?.roles ?? []) for (const p of ROLE_PERMS[r] ?? []) if (!UNGRANTED.includes(p)) out.add(p);
  return out;
}

/** Admins see every brand; others need the brand assigned and at least one non-admin role. */
export function canSeeBrand(a: Access | null | undefined, brand: string): boolean {
  if (!a) return false;
  if (isAdmin(a)) return true;
  return a.roles.some((r) => r !== "admin") && a.brands.includes(brand);
}

export function can(a: Access | null | undefined, perm: Perm, brand?: string): boolean {
  if (!a || !permsOf(a).has(perm)) return false;
  return brand === undefined || canSeeBrand(a, brand);
}

export function visibleBrands<T extends { slug: string }>(a: Access | null | undefined, brands: T[]): T[] {
  return brands.filter((b) => canSeeBrand(a, b.slug));
}

/** Which Action Log categories this person may log. */
export function allowedActionCategories(a: Access | null | undefined, all: ActionCategory[]): ActionCategory[] {
  const p = permsOf(a);
  if (p.has("actions.log_all")) return all;
  if (p.has("actions.log")) return all.filter((c) => CATALOG_ACTION_CATEGORIES.includes(c));
  return [];
}

// ── Tasks ─────────────────────────────────────────────────────────────

type TaskLike = { brandSlug: string; ownerEmail: string | null; createdBy: string | null };
const same = (x: string | null | undefined, y: string | null | undefined) => !!x && !!y && x.toLowerCase() === y.toLowerCase();

/** all = every task on visible brands (admins, brand managers); own = owned or created by me. */
export function taskScope(a: Access | null | undefined): "all" | "own" | "none" {
  const p = permsOf(a);
  if (p.has("tasks.team") || isAdmin(a)) return "all";
  return p.has("tasks.view") ? "own" : "none";
}

export function canSeeTask(a: Access | null | undefined, t: TaskLike): boolean {
  if (!a || !canSeeBrand(a, t.brandSlug)) return false;
  const scope = taskScope(a);
  if (scope === "all") return true;
  if (scope === "own") return same(t.ownerEmail, a.email) || same(t.createdBy, a.email);
  return false;
}

export function visibleTasks<T extends TaskLike>(a: Access | null | undefined, tasks: T[]): T[] {
  return tasks.filter((t) => canSeeTask(a, t));
}

/**
 * Teammates this person may assign a task to on a brand. `members` = people who can see that
 * brand. Admins: anyone on it. Brand managers: themselves + their direct reports on it.
 * Everyone else: only themselves.
 */
export function assignableEmails(a: Access | null | undefined, members: string[]): string[] {
  if (!a) return [];
  const lower = members.map((m) => m.toLowerCase());
  if (isAdmin(a)) return lower;
  const mine = [a.email.toLowerCase()];
  if (permsOf(a).has("tasks.team")) mine.push(...a.team.map((t) => t.email.toLowerCase()));
  return lower.filter((m) => mine.includes(m));
}

/** Future: actions by people at junior level will need a manager's approval. Not enforced yet. */
export function requiresApproval(_a: Access | null | undefined, _perm: Perm): boolean {
  return false;
}

// ── Navigation ─────────────────────────────────────────────────────────

/** Brand pages and the permission each needs (used by the sidebar and the server guards). */
export const BRAND_PAGES: Array<{ path: string; perm: Perm }> = [
  { path: "", perm: "overview" },
  { path: "reports", perm: "reports" },
  { path: "what-changed", perm: "what_changed" },
  { path: "goals", perm: "goals.view" },
  { path: "campaigns", perm: "campaigns" },
  { path: "search-terms", perm: "search_terms" },
  { path: "hourly", perm: "hourly" },
  { path: "products", perm: "products" },
  { path: "inventory", perm: "catalog_inventory" },
  { path: "meetings", perm: "meetings.view" },
  { path: "tasks", perm: "tasks.view" },
  { path: "actions", perm: "actions.view" },
];

/** Serializable summary for client components (sidebar). */
export type AccessSummary = { email: string; roles: Role[]; perms: Perm[]; admin: boolean };
export function summarize(a: Access): AccessSummary {
  return { email: a.email, roles: a.roles, perms: [...permsOf(a)], admin: isAdmin(a) };
}
