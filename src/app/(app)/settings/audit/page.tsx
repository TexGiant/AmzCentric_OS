import { Card, CardHeader, PageHeader } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { requireAdminAccess } from "@/lib/access";
import { listAudit } from "@/lib/audit";
import { data } from "@/lib/data";
import { inputClass, labelClass, selectClass, buttonClass, cn } from "@/components/ui";
import { param, type SearchParams } from "@/lib/page";

const ACTIONS: Array<[string, string]> = [
  ["", "All events"],
  ["auth.", "Sign-ins"],
  ["access.denied", "Access denied"],
  ["team.", "Team & access changes"],
  ["export.", "CSV exports"],
  ["connector.", "Claude connector"],
  ["action.", "Action Log"],
  ["goal.", "Goals"],
  ["meeting.", "Meetings"],
  ["task.", "Tasks"],
  ["brand.", "Brands"],
  ["profile.", "Profiles"],
  ["sync.", "Data sync"],
  ["stream.", "Marketing Stream"],
  ["amazon.", "Amazon connections"],
];

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminAccess();
  const sp = await searchParams;
  const f = {
    actor: param(sp, "actor") || undefined,
    action: param(sp, "action") || undefined,
    brand: param(sp, "brand") || undefined,
    via: param(sp, "via") || undefined,
    from: param(sp, "from") || undefined,
    to: param(sp, "to") || undefined,
    limit: 1000,
  };
  const [rows, brands] = await Promise.all([listAudit(f), data().listBrands()]);

  return (
    <>
      <PageHeader eyebrow="Settings · admin" title="Audit log" subtitle="Sign-ins, access changes, exports, Claude connector calls and every change — who, what, when, which brand." />
      <Card>
        <form className="grid gap-3 p-6 md:grid-cols-12" method="get">
          <label className="md:col-span-3">
            <span className={labelClass}>Person (email)</span>
            <input name="actor" defaultValue={f.actor} placeholder="anyone" className={inputClass} />
          </label>
          <label className="md:col-span-2">
            <span className={labelClass}>Event</span>
            <select name="action" defaultValue={f.action ?? ""} className={selectClass}>
              {ACTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="md:col-span-2">
            <span className={labelClass}>Brand</span>
            <select name="brand" defaultValue={f.brand ?? ""} className={selectClass}>
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="md:col-span-1">
            <span className={labelClass}>Via</span>
            <select name="via" defaultValue={f.via ?? ""} className={selectClass}>
              <option value="">Any</option>
              <option value="app">App</option>
              <option value="connector">Claude</option>
              <option value="webhook">Webhook</option>
              <option value="system">System</option>
            </select>
          </label>
          <label className="md:col-span-2">
            <span className={labelClass}>From</span>
            <input type="date" name="from" defaultValue={f.from} className={inputClass} />
          </label>
          <label className="md:col-span-2">
            <span className={labelClass}>To</span>
            <input type="date" name="to" defaultValue={f.to} className={inputClass} />
          </label>
          <div className="flex gap-2 md:col-span-12">
            <button className={cn(buttonClass.primary, buttonClass.small)}>Filter</button>
            <a href="/settings/audit" className={cn(buttonClass.ghost, buttonClass.small)}>
              Clear
            </a>
          </div>
        </form>
      </Card>
      <Card className="mt-4">
        <CardHeader title={`${rows.length.toLocaleString()} events`} sub={rows.length >= 1000 ? "Showing the newest 1,000 — narrow the filters to see older events." : undefined} />
        <DataTable
          exportName="audit-log"
          searchKeys={["actorEmail", "action", "target", "detailText"]}
          defaultSort={{ key: "at", dir: "desc" }}
          pageSize={100}
          columns={[
            { key: "when", label: "When (UTC)", sortKey: "at", nowrap: true },
            { key: "actorEmail", label: "Who" },
            { key: "action", label: "Event", nowrap: true },
            { key: "brand", label: "Brand" },
            { key: "target", label: "What" },
            { key: "via", label: "Via", badge: { app: "neutral", connector: "info", webhook: "warn", system: "neutral" } },
            { key: "detailText", label: "Details", width: "32%" },
          ]}
          rows={rows.map((r) => ({
            ...r,
            when: r.at.replace("T", " ").slice(0, 19),
            detailText: Object.keys(r.detail).length ? JSON.stringify(r.detail) : "",
          }))}
          empty="No events match these filters."
        />
      </Card>
    </>
  );
}
