import { Card, CardHeader, Kpi, PageHeader, Pill } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { SyncPanel } from "@/components/settings-forms";
import { requireAdminAccess } from "@/lib/access";
import { isDemoMode } from "@/lib/env";
import { REPORT_SPECS, type ReportType } from "@/lib/pipeline/report-specs";
import { createAdminClient } from "@/lib/supabase/admin";
import { streamConfigured } from "@/lib/stream/sqs";

type Job = {
  id: string;
  profile_id: string;
  report_type: ReportType;
  start_date: string;
  end_date: string;
  status: string;
  source: string;
  attempts: number;
  rows_ingested: number | null;
  error: string | null;
  created_at: string;
};

export default async function SyncPage() {
  await requireAdminAccess();
  const demo = isDemoMode();
  let jobs: Job[] = [];
  let profiles: Array<{ id: string; label: string }> = [];
  let pending = 0;
  let failed24 = 0;
  let streamLast: string | null = null;
  let stream24 = 0;

  if (!demo) {
    const db = createAdminClient();
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const [j, p, pend, fail, last, count] = await Promise.all([
      db.from("report_jobs").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("amazon_profiles").select("profile_id, account_name, country_code, display_name, brand_slug").eq("enabled", true).order("account_name"),
      db.from("report_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
      db.from("report_jobs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since),
      db.from("stream_traffic").select("received_at").order("received_at", { ascending: false }).limit(1),
      db.from("stream_traffic").select("idempotency_id", { count: "exact", head: true }).gte("received_at", since),
    ]);
    jobs = (j.data ?? []) as Job[];
    profiles = (p.data ?? []).map((r) => ({
      id: r.profile_id,
      label: `${r.display_name || r.account_name || r.profile_id} · ${r.country_code ?? ""}${r.brand_slug ? ` → ${r.brand_slug}` : ""}`,
    }));
    pending = pend.count ?? 0;
    failed24 = fail.count ?? 0;
    streamLast = (last.data?.[0]?.received_at as string) ?? null;
    stream24 = count.count ?? 0;
  }

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Data sync"
        subtitle="Daily reports (last 7 days) are requested at 11:00 and 19:00 UTC, about 3 AM and 11 AM Pacific, checked every 30 minutes, and Marketing Stream is pulled from SQS every 10 minutes."
        right={demo ? <Pill tone="warn">Demo mode: nothing to sync</Pill> : undefined}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Reports pending" value={String(pending)} />
        <Kpi label="Failed · 24h" value={String(failed24)} />
        <Kpi label="Stream messages · 24h" value={stream24.toLocaleString()} />
        <Kpi
          label="Last stream message"
          value={streamLast ? new Date(streamLast).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—"}
          sub={streamConfigured() ? "SQS configured" : "Set STREAM_SQS_QUEUE_URLS"}
        />
      </div>
      <Card className="mt-6">
        <CardHeader title="Manual sync" />
        <SyncPanel profiles={profiles} streamConfigured={streamConfigured() && !demo} />
      </Card>
      <Card className="mt-4">
        <CardHeader title="Recent report jobs" />
        <DataTable
          defaultSort={{ key: "created_at", dir: "desc" }}
          pageSize={25}
          searchKeys={["profile_id", "report", "status", "error"]}
          empty="No report jobs yet. Run a backfill above."
          columns={[
            { key: "created", label: "Requested" },
            { key: "profile_id", label: "Profile" },
            { key: "report", label: "Report" },
            { key: "window", label: "Dates" },
            { key: "source", label: "Source" },
            { key: "status", label: "Status", badge: { completed: "good", pending: "warn", failed: "bad" } },
            { key: "rows_ingested", label: "Rows", format: "int" },
            { key: "error", label: "Error" },
          ]}
          rows={jobs.map((j) => ({
            ...j,
            created: new Date(j.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
            report: REPORT_SPECS[j.report_type]?.label ?? j.report_type,
            window: `${j.start_date} → ${j.end_date}`,
            error: j.error?.slice(0, 140) ?? null,
          }))}
        />
      </Card>
    </>
  );
}
