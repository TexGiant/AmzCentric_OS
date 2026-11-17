import { Card, CardHeader, PageHeader, Pill, buttonClass } from "@/components/ui";
import { InviteForm } from "@/components/settings-forms";
import { removeMember, setRole } from "@/app/settings-actions";
import { requireAdmin } from "@/lib/auth";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

type Member = { id: string; email: string; role: string; lastSignIn: string | null; invited: boolean };

export default async function TeamPage() {
  const me = await requireAdmin();
  let members: Member[] = [];
  if (isDemoMode()) {
    members = [
      { id: "demo", email: me.email, role: "admin", lastSignIn: new Date().toISOString(), invited: false },
      { id: "d2", email: "sam@amzcentric.com", role: "member", lastSignIn: null, invited: true },
    ];
  } else {
    const db = createAdminClient();
    const [{ data: roles }, { data: auth }] = await Promise.all([
      db.from("app_users").select("user_id, email, role"),
      db.auth.admin.listUsers({ perPage: 200 }),
    ]);
    const byId = new Map((auth?.users ?? []).map((u) => [u.id, u]));
    members = (roles ?? []).map((r) => {
      const u = byId.get(r.user_id);
      return {
        id: r.user_id,
        email: r.email,
        role: r.role,
        lastSignIn: u?.last_sign_in_at ?? null,
        invited: !!u?.invited_at && !u?.last_sign_in_at,
      };
    });
  }

  return (
    <>
      <PageHeader eyebrow="Settings · admin" title="Team" subtitle="Invite teammates by email. They set a password from the invite link." />
      <Card>
        <CardHeader title="Invite a teammate" />
        <InviteForm />
      </Card>
      <Card className="mt-4">
        <CardHeader title={`${members.length} members`} />
        <ul className="divide-y divide-line border-t border-line">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink">{m.email}</div>
                <div className="text-xs text-muted">
                  {m.lastSignIn ? `Last sign-in ${new Date(m.lastSignIn).toLocaleDateString("en-US")}` : "Never signed in"}
                </div>
              </div>
              {m.invited && <Pill tone="warn">Invite pending</Pill>}
              {m.id === me.id ? (
                <Pill tone="brand">{m.role} · you</Pill>
              ) : (
                <>
                  <form action={setRole} className="flex items-center gap-1">
                    <input type="hidden" name="user_id" value={m.id} />
                    <input type="hidden" name="role" value={m.role === "admin" ? "member" : "admin"} />
                    <Pill tone={m.role === "admin" ? "brand" : "neutral"}>{m.role}</Pill>
                    <button className="text-xs font-medium text-brand hover:underline">Make {m.role === "admin" ? "member" : "admin"}</button>
                  </form>
                  <form action={removeMember}>
                    <input type="hidden" name="user_id" value={m.id} />
                    <button className={buttonClass.danger}>Remove</button>
                  </form>
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
