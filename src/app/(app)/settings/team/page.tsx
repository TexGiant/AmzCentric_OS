import { Avatar, Card, CardHeader, PageHeader, Pill, buttonClass } from "@/components/ui";
import { AccountActions, InviteForm, MemberForm } from "@/components/team-forms";
import { removeMember } from "@/app/team-actions";
import { requireAdminAccess } from "@/lib/access";
import { data } from "@/lib/data";
import { DEMO_USERS } from "@/lib/demo-users";
import { isDemoMode } from "@/lib/env";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";

type Member = {
  id: string;
  email: string;
  roles: Role[];
  brands: string[];
  reportsTo: string | null;
  lastSignIn: string | null;
  invited: boolean;
};

export default async function TeamPage() {
  const me = await requireAdminAccess();
  const brands = (await data().listBrands()).map((b) => ({ slug: b.slug, name: b.name }));
  let members: Member[] = [];
  if (isDemoMode()) {
    members = DEMO_USERS.map((u) => ({ id: u.userId, email: u.email, roles: u.roles, brands: u.brands, reportsTo: u.reportsTo, lastSignIn: null, invited: false }));
  } else {
    const db = createAdminClient();
    const [{ data: users }, { data: roles }, { data: assigned }, { data: auth }] = await Promise.all([
      db.from("app_users").select("user_id, email, reports_to").order("email"),
      db.from("user_roles").select("user_id, role"),
      db.from("user_brands").select("user_id, brand_slug"),
      db.auth.admin.listUsers({ perPage: 1000 }),
    ]);
    const byId = new Map((auth?.users ?? []).map((u) => [u.id, u]));
    members = (users ?? []).map((r: { user_id: string; email: string; reports_to: string | null }) => {
      const u = byId.get(r.user_id);
      return {
        id: r.user_id,
        email: r.email,
        roles: (roles ?? []).filter((x: { user_id: string }) => x.user_id === r.user_id).map((x: { role: string }) => x.role as Role),
        brands: (assigned ?? []).filter((x: { user_id: string }) => x.user_id === r.user_id).map((x: { brand_slug: string }) => x.brand_slug),
        reportsTo: r.reports_to,
        lastSignIn: u?.last_sign_in_at ?? null,
        invited: !!u?.invited_at && !u?.last_sign_in_at,
      };
    });
  }
  const managers = members.filter((m) => m.roles.includes("brand_manager")).map((m) => ({ id: m.id, email: m.email }));
  const emailOf = new Map(members.map((m) => [m.id, m.email]));
  const brandName = new Map(brands.map((b) => [b.slug, b.name]));
  const order = (r: Role) => ROLES.indexOf(r);

  return (
    <>
      <PageHeader
        eyebrow="Settings · admin"
        title="Team"
        subtitle="Give each person roles and brands. People only ever see the brands assigned to them; admins see all. Password resets are admin-only: open a person → Send password reset."
      />
      <Card>
        <CardHeader title="Invite a teammate" sub="They get an email to set a password, and land on exactly the brands you pick." />
        <InviteForm brands={brands} managers={managers} />
      </Card>
      <Card className="mt-4">
        <CardHeader title={`${members.length} people`} sub="Open a person to change their roles, brands or manager." />
        <ul className="divide-y divide-line">
          {members.map((m) => {
            const isAdmin = m.roles.includes("admin");
            return (
              <li key={m.id}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-6 py-4 hover:bg-canvas">
                    <Avatar email={m.email} tone={isAdmin ? "gold" : "navy"} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-ink">
                        {m.email}
                        {m.id === me.userId && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        {isAdmin
                          ? "All brands"
                          : m.brands.length
                            ? m.brands.map((b) => brandName.get(b) ?? b).join(", ")
                            : "No brands assigned"}
                        {m.reportsTo && ` · reports to ${emailOf.get(m.reportsTo) ?? "—"}`}
                        {" · "}
                        {m.lastSignIn ? `last sign-in ${new Date(m.lastSignIn).toLocaleDateString("en-US")}` : "never signed in"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {m.roles.length === 0 && <Pill tone="bad">No roles</Pill>}
                      {[...m.roles].sort((a, b) => order(a) - order(b)).map((r) => (
                        <Pill key={r} tone={r === "admin" ? "solid" : "neutral"}>
                          {ROLE_LABELS[r]}
                        </Pill>
                      ))}
                      {m.invited && (
                        <Pill tone="warn" dot>
                          Invite pending
                        </Pill>
                      )}
                    </div>
                    <span className="text-xs font-semibold text-brand-ink group-open:hidden">Edit</span>
                    <span className="hidden text-xs font-semibold text-muted group-open:inline">Close</span>
                  </summary>
                  <MemberForm userId={m.id} brands={brands} managers={managers} roles={m.roles} assigned={m.brands} reportsTo={m.reportsTo} />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas/50 px-6 py-3">
                    <AccountActions userId={m.id} invited={m.invited} />
                    {m.id !== me.userId && (
                      <form action={removeMember}>
                        <input type="hidden" name="user_id" value={m.id} />
                        <button className={buttonClass.danger}>Remove from team</button>
                      </form>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
