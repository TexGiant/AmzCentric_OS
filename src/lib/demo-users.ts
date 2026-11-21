import type { Access } from "@/lib/rbac";

/**
 * Sample people for demo mode, one per role mix, so access rules can be tried without
 * Supabase. Picked with the dev-only user switcher (cookie below); never used in production.
 */
export const DEMO_USER_COOKIE = "amz_demo_user";

export const DEMO_USERS: Array<Access & { label: string }> = [
  { label: "Admin", userId: "demo-admin", email: "demo@amzcentric.com", roles: ["admin"], juniorRoles: [], brands: [], reportsTo: null, team: [] },
  {
    label: "Brand manager · Harbor & Pine, Lumen Labs",
    userId: "demo-bm",
    email: "sara@amzcentric.com",
    roles: ["brand_manager"],
    juniorRoles: [],
    brands: ["harbor-pine", "lumen-labs"],
    reportsTo: null,
    team: [
      { userId: "demo-ppc", email: "ali@amzcentric.com" },
      { userId: "demo-cat", email: "nina@amzcentric.com" },
      { userId: "demo-multi", email: "omar@amzcentric.com" },
    ],
  },
  { label: "PPC manager · Harbor & Pine", userId: "demo-ppc", email: "ali@amzcentric.com", roles: ["ppc_manager"], juniorRoles: [], brands: ["harbor-pine"], reportsTo: "demo-bm", team: [] },
  {
    label: "Catalog manager · Harbor & Pine, Kodiak Trail",
    userId: "demo-cat",
    email: "nina@amzcentric.com",
    roles: ["catalog_manager"],
    juniorRoles: [],
    brands: ["harbor-pine", "kodiak-trail"],
    reportsTo: "demo-bm",
    team: [],
  },
  {
    label: "PPC + Catalog · Lumen Labs",
    userId: "demo-multi",
    email: "omar@amzcentric.com",
    roles: ["ppc_manager", "catalog_manager"],
    juniorRoles: [],
    brands: ["lumen-labs"],
    reportsTo: "demo-bm",
    team: [],
  },
  { label: "New hire · no roles yet", userId: "demo-new", email: "new@amzcentric.com", roles: [], juniorRoles: [], brands: [], reportsTo: null, team: [] },
];

export function demoUser(id: string | undefined) {
  return DEMO_USERS.find((u) => u.userId === id) ?? DEMO_USERS[0];
}
