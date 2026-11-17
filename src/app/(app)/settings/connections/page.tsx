import { PlugZap } from "lucide-react";
import { Card, CardHeader, Empty, PageHeader, Pill, buttonClass, inputClass } from "@/components/ui";
import { disconnectAccount, renameAccount, updateProfile } from "@/app/settings-actions";
import { requireUser } from "@/lib/auth";
import { REGIONS, type Region } from "@/lib/amazon/ads";
import { data } from "@/lib/data";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { param, type SearchParams } from "@/lib/page";

type ProfileRow = {
  profile_id: string;
  country_code: string | null;
  account_name: string | null;
  account_type: string | null;
  display_name: string | null;
  brand_slug: string | null;
  enabled: boolean;
};
type AccountRow = { id: string; name: string; region: Region; created_at: string; last_error: string | null; amazon_profiles: ProfileRow[] };

export default async function ConnectionsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const brands = await data().listBrands();
  const demo = isDemoMode();

  let accounts: AccountRow[] = [];
  if (!demo) {
    const { data: rows, error } = await createAdminClient()
      .from("amazon_accounts")
      .select("id, name, region, created_at, last_error, amazon_profiles(profile_id, country_code, account_name, account_type, display_name, brand_slug, enabled)")
      .order("created_at");
    if (error) throw error;
    accounts = (rows ?? []) as AccountRow[];
  }
  const error = param(sp, "error");
  const connected = param(sp, "connected");

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Amazon connections"
        subtitle="Connect Amazon Ads accounts with Login with Amazon, then enable profiles and assign each one to a brand."
        right={(Object.keys(REGIONS) as Region[]).map((r) => (
          <a key={r} href={`/api/amazon/authorize?region=${r}`} className={r === "NA" ? buttonClass.primary : buttonClass.secondary}>
            <PlugZap className="size-4" strokeWidth={1.5} /> Connect {r}
          </a>
        ))}
      />
      {error && (
        <div className="mb-4 rounded-xl border border-bad/20 bg-bad-soft px-4 py-3 text-sm text-bad">
          {error === "demo" ? "Demo mode: add Supabase + Amazon credentials to connect real accounts." : error}
        </div>
      )}
      {connected && (
        <div className="mb-4 rounded-xl border border-good/20 bg-good-soft px-4 py-3 text-sm text-good">
          Connected. Imported {connected} advertising profile(s). Enable the ones you manage and assign them to brands.
        </div>
      )}

      {accounts.length === 0 && (
        <Card>
          <Empty icon={<PlugZap className="size-8" strokeWidth={1.5} />} title={demo ? "Demo mode" : "No Amazon accounts connected"}>
            {demo
              ? "The dashboards are showing generated data. Follow the README to add Supabase and Amazon Ads credentials, then connect here."
              : "Click “Connect NA” (or EU/FE) and approve access with the Amazon login that has your advertising accounts."}
          </Empty>
        </Card>
      )}

      <div className="space-y-4">
        {accounts.map((a) => {
          const enabled = a.amazon_profiles.filter((p) => p.enabled).length;
          return (
            <Card key={a.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                <form action={renameAccount} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={a.id} />
                  <input name="name" defaultValue={a.name} className={`${inputClass} w-64 font-medium`} aria-label="Account name" />
                  <button className="text-xs font-medium text-brand hover:underline">Rename</button>
                </form>
                <div className="flex items-center gap-2">
                  <Pill tone="brand">{REGIONS[a.region].label}</Pill>
                  <Pill tone={enabled ? "good" : "neutral"} dot>
                    {enabled} of {a.amazon_profiles.length} enabled
                  </Pill>
                  {user.role === "admin" && (
                    <form action={disconnectAccount}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className={buttonClass.danger}>Disconnect</button>
                    </form>
                  )}
                </div>
              </div>
              {a.last_error && <div className="bg-bad-soft px-5 py-2 text-xs text-bad">{a.last_error}</div>}
              <CardHeader title="Advertising profiles" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-y border-line bg-canvas/60 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                      <th className="py-2.5 pr-3 pl-5">Profile</th>
                      <th className="pr-5 pl-3" colSpan={4}>
                        Display name · Brand · Enabled
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...a.amazon_profiles]
                      .sort((x, y) => Number(y.enabled) - Number(x.enabled) || (x.account_name ?? "").localeCompare(y.account_name ?? ""))
                      .map((p) => (
                        <tr key={p.profile_id} className="border-b border-line/70 last:border-0">
                          <td className="py-2.5 pr-3 pl-5">
                            <div className="font-medium text-ink">
                              {p.account_name ?? p.profile_id} <span className="text-faint">· {p.country_code}</span>
                            </div>
                            <div className="text-xs text-faint">
                              {p.profile_id} · {p.account_type}
                            </div>
                          </td>
                          <td className="pr-5 pl-3" colSpan={4}>
                            <form action={updateProfile} className="flex items-center gap-3">
                              <input type="hidden" name="profile_id" value={p.profile_id} />
                              <input name="display_name" defaultValue={p.display_name ?? ""} placeholder="optional" className={`${inputClass} w-44`} />
                              <select name="brand_slug" defaultValue={p.brand_slug ?? ""} className={`${inputClass} w-48`}>
                                <option value="">— Unassigned —</option>
                                {brands.map((b) => (
                                  <option key={b.slug} value={b.slug}>
                                    {b.name}
                                  </option>
                                ))}
                              </select>
                              <input type="checkbox" name="enabled" defaultChecked={p.enabled} className="size-4 accent-[var(--color-brand)]" />
                              <button className="ml-auto text-xs font-medium text-brand hover:underline">Save</button>
                            </form>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
