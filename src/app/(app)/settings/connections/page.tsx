import { Suspense } from "react";
import { PlugZap, Radio } from "lucide-react";
import { Alert, Card, CardHeader, Empty, PageHeader, Pill, buttonClass, cn, inputClass, selectClass } from "@/components/ui";
import { disconnectAccount, refreshProfiles, renameAccount, updateProfile } from "@/app/settings-actions";
import { PendingButton } from "@/components/settings-forms";
import { requireUser } from "@/lib/auth";
import { REGIONS, type AdsAccount, type Region } from "@/lib/amazon/ads";
import { AD_TYPES, StreamStatusCells } from "@/components/stream-status";
import { streamDestinations } from "@/lib/stream/sqs";
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
type AccountRow = { id: string; name: string; region: Region; refresh_token: string; created_at: string; last_error: string | null; amazon_profiles: ProfileRow[] };

// Subscribing waits for Amazon's confirmation message, so give the action time.
export const maxDuration = 60;

export default async function ConnectionsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const brands = await data().listBrands();
  const demo = isDemoMode();

  let accounts: AccountRow[] = [];
  if (!demo) {
    const { data: rows, error } = await createAdminClient()
      .from("amazon_accounts")
      .select("id, name, region, refresh_token, created_at, last_error, amazon_profiles(profile_id, country_code, account_name, account_type, display_name, brand_slug, enabled)")
      .order("created_at");
    if (error) throw error;
    accounts = (rows ?? []) as AccountRow[];
  }
  const error = param(sp, "error");
  const connected = param(sp, "connected");
  const streamOk = param(sp, "stream_ok");
  const refreshed = param(sp, "refreshed");
  const streamError = param(sp, "stream_error");
  const destinations = streamDestinations();
  const enabledProfiles = accounts.flatMap((a) =>
    a.amazon_profiles
      .filter((p) => p.enabled)
      .map((p) => ({ ...p, account: { id: a.id, region: a.region, refresh_token: a.refresh_token } satisfies AdsAccount })),
  );

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
        <Alert tone={error === "demo" ? "warn" : "bad"} title={error === "demo" ? "Demo mode" : "Connection failed"}>
          {error === "demo" ? "Add Supabase and Amazon Ads credentials to connect real accounts." : error}
        </Alert>
      )}
      {connected && (
        <Alert tone="good" title="Amazon account connected">
          Imported {connected} advertising profile(s). Enable the ones you manage and assign them to brands.
        </Alert>
      )}

      {refreshed && (
        <Alert tone="good" title="Profiles refreshed">
          {refreshed}. New profiles start disabled: enable them and pick a brand below.
        </Alert>
      )}
      {streamOk && (
        <Alert tone="good" title="Marketing Stream">
          {streamOk}. Hourly data starts arriving within about an hour.
        </Alert>
      )}
      {streamError && (
        <Alert tone="bad" title="Marketing Stream subscription failed">
          {streamError}
        </Alert>
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
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
                <form action={renameAccount} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={a.id} />
                  <input name="name" defaultValue={a.name} className={cn(inputClass, "w-64 font-semibold")} aria-label="Account name" />
                  <button className={cn(buttonClass.ghost, buttonClass.small)}>Rename</button>
                </form>
                <div className="flex items-center gap-2">
                  <form action={refreshProfiles}>
                    <input type="hidden" name="id" value={a.id} />
                    <PendingButton pendingText="Refreshing…" className={cn(buttonClass.secondary, buttonClass.small)}>
                      Refresh profiles
                    </PendingButton>
                  </form>
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
              {a.last_error && <div className="border-b border-line bg-bad-soft px-6 py-2.5 text-xs font-semibold text-bad-ink">{a.last_error}</div>}
              <CardHeader title="Advertising profiles" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-line bg-canvas text-left text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
                      <th className="py-3 pr-4 pl-6">Profile</th>
                      <th className="pr-5 pl-3" colSpan={4}>
                        Display name · Brand · Enabled
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...a.amazon_profiles]
                      .sort((x, y) => Number(y.enabled) - Number(x.enabled) || (x.account_name ?? "").localeCompare(y.account_name ?? ""))
                      .map((p) => (
                        <tr key={p.profile_id} className="border-b border-line transition-colors last:border-0 hover:bg-canvas">
                          <td className="py-3 pr-4 pl-6">
                            <div className="font-semibold text-ink">
                              {p.account_name ?? p.profile_id} <span className="text-faint">· {p.country_code}</span>
                            </div>
                            <div className="text-xs text-faint">
                              {p.profile_id} · {p.account_type}
                            </div>
                          </td>
                          <td className="pr-5 pl-3" colSpan={4}>
                            <form action={updateProfile} className="flex items-center gap-3">
                              <input type="hidden" name="profile_id" value={p.profile_id} />
                              <input name="display_name" defaultValue={p.display_name ?? ""} placeholder="Display name" className={cn(inputClass, "w-44")} />
                              <select name="brand_slug" defaultValue={p.brand_slug ?? ""} className={cn(selectClass, "w-48")}>
                                <option value="">— Unassigned —</option>
                                {brands.map((b) => (
                                  <option key={b.slug} value={b.slug}>
                                    {b.name}
                                  </option>
                                ))}
                              </select>
                              <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink-2">
                                <input type="checkbox" name="enabled" defaultChecked={p.enabled} className="amz-check" />
                                Enabled
                              </label>
                              <button className={cn(buttonClass.secondary, buttonClass.small, "ml-auto")}>Save</button>
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

      {enabledProfiles.length > 0 && (
        <Card className="mt-4">
          <div id="stream" className="scroll-mt-6" />
          <CardHeader
            title="Marketing Stream (hourly data)"
            sub="Each enabled profile needs its own subscription per dataset to send hourly data to your SQS queues. Hover a status for details."
          />
          <div className="grid gap-x-6 gap-y-1 border-b border-line px-6 py-3 text-xs text-muted sm:grid-cols-2">
            {AD_TYPES.flatMap((t) => t.datasets).map((d) => (
              <span key={d} className="truncate">
                <span className="inline-block w-24 font-semibold text-ink-2">{d}</span>
                {destinations[d] ? <code className="text-ink-2">{destinations[d]}</code> : <span className="text-faint">no queue configured</span>}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line bg-canvas text-left text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
                  <th className="py-3 pr-4 pl-6">Profile</th>
                  {AD_TYPES.map((t) => (
                    <th key={t.key} className="px-4" title={t.label}>
                      {t.key}
                    </th>
                  ))}
                  <th className="pr-6" />
                </tr>
              </thead>
              <tbody>
                {enabledProfiles.map((p) => (
                  <tr key={p.profile_id} className="border-b border-line last:border-0">
                    <td className="py-3 pr-4 pl-6">
                      <div className="font-semibold text-ink">
                        {p.display_name || p.account_name || p.profile_id} <span className="text-faint">· {p.country_code}</span>
                      </div>
                      <div className="text-xs text-faint">{p.profile_id}</div>
                    </td>
                    <Suspense
                      fallback={
                        <td className="px-4 py-3 text-xs text-muted" colSpan={AD_TYPES.length + 1}>
                          <Radio className="mr-1.5 inline size-3.5 animate-pulse" strokeWidth={1.5} />
                          Checking with Amazon…
                        </td>
                      }
                    >
                      <StreamStatusCells account={p.account} profileId={p.profile_id} destinations={destinations} />
                    </Suspense>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
