import "server-only";
import { gunzipSync } from "node:zlib";
import { adsRequest, AdsApiError, type AdsAccount } from "@/lib/amazon/ads";
import { addDays, chunkRange, todayInTz, todayUtc } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ALL_REPORT_TYPES,
  campaignDimensions,
  dedupeRows,
  REPORT_SPECS,
  type ReportType,
} from "@/lib/pipeline/report-specs";

type ProfileWithAccount = { profile_id: string; timezone: string; account: AdsAccount };
type JobSource = "cron" | "backfill" | "manual";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadProfiles(profileIds?: string[]): Promise<ProfileWithAccount[]> {
  const db = createAdminClient();
  let q = db
    .from("amazon_profiles")
    .select("profile_id, timezone, account:amazon_accounts(id, region, refresh_token)")
    .eq("enabled", true);
  if (profileIds?.length) q = q.in("profile_id", profileIds);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((p) => ({
    profile_id: p.profile_id as string,
    timezone: p.timezone as string,
    account: (Array.isArray(p.account) ? p.account[0] : p.account) as AdsAccount,
  }));
}

/** POST /reporting/reports. Returns Amazon's reportId (re-uses it on a 425 duplicate). */
async function createReport(account: AdsAccount, profileId: string, type: ReportType, start: string, end: string) {
  const spec = REPORT_SPECS[type];
  try {
    const res = await adsRequest<{ reportId: string }>(account, "/reporting/reports", {
      method: "POST",
      profileId,
      contentType: "application/vnd.createasyncreportrequest.v3+json",
      body: {
        name: `amzcentric ${type} ${start}..${end}`,
        startDate: start,
        endDate: end,
        configuration: {
          adProduct: spec.adProduct,
          groupBy: spec.groupBy,
          columns: spec.columns,
          reportTypeId: type,
          timeUnit: "DAILY",
          format: "GZIP_JSON",
        },
      },
    });
    return res.reportId;
  } catch (err) {
    if (err instanceof AdsApiError && err.status === 425) {
      const dup = err.body.match(/duplicate of\s*:?\s*([0-9a-f-]{36})/i);
      if (dup) return dup[1];
    }
    throw err;
  }
}

export type RequestResult = { created: number; failed: number; errors: string[] };

/** Request reports for profiles × types × date window, recording each in report_jobs. */
export async function requestReports(opts: {
  profileIds?: string[];
  types?: ReportType[];
  windows: (p: ProfileWithAccount) => Array<[string, string]>;
  source: JobSource;
  paceMs?: number;
}): Promise<RequestResult> {
  const db = createAdminClient();
  const profiles = await loadProfiles(opts.profileIds);
  const types = opts.types?.length ? opts.types : ALL_REPORT_TYPES;
  const result: RequestResult = { created: 0, failed: 0, errors: [] };

  for (const profile of profiles) {
    for (const type of types) {
      for (const [start, end] of opts.windows(profile)) {
        try {
          const reportId = await createReport(profile.account, profile.profile_id, type, start, end);
          await db.from("report_jobs").insert({
            profile_id: profile.profile_id,
            report_type: type,
            start_date: start,
            end_date: end,
            amazon_report_id: reportId,
            source: opts.source,
          });
          result.created++;
        } catch (err) {
          const msg = err instanceof AdsApiError ? `${err.message}: ${err.body.slice(0, 300)}` : String(err);
          await db.from("report_jobs").insert({
            profile_id: profile.profile_id,
            report_type: type,
            start_date: start,
            end_date: end,
            status: "failed",
            source: opts.source,
            error: msg,
          });
          result.failed++;
          result.errors.push(`${profile.profile_id} ${type}: ${msg}`);
        }
        if (opts.paceMs) await sleep(opts.paceMs);
      }
    }
  }
  return result;
}

/** Daily cron: re-request the trailing N days so late-attributed sales get restated. */
export function requestDaily() {
  const lookback = Math.max(1, Number(process.env.REQUEST_LOOKBACK_DAYS ?? 7));
  return requestReports({
    source: "cron",
    paceMs: 120,
    windows: (p) => {
      const end = addDays(todayInTz(p.timezone), -1);
      return [[addDays(end, -(lookback - 1)), end]];
    },
  });
}

/** Historical backfill, chunked into 31-day windows and capped at each report's retention. */
export function backfill(days: number, profileIds?: string[], types?: ReportType[]) {
  const wanted = types?.length ? types : ALL_REPORT_TYPES;
  // Group types by retention so each gets a valid window.
  const byRetention = new Map<number, ReportType[]>();
  for (const t of wanted) {
    const r = Math.min(days, REPORT_SPECS[t].retentionDays);
    byRetention.set(r, [...(byRetention.get(r) ?? []), t]);
  }
  return Promise.all(
    [...byRetention.entries()].map(([d, ts]) => {
      // Amazon counts retention back from *its* today (UTC), which can already be a day
      // ahead of the marketplace — so never start earlier than UTC today − retention,
      // with a 1-day safety margin.
      const retention = Math.min(...ts.map((t) => REPORT_SPECS[t].retentionDays));
      const earliest = addDays(todayUtc(), -(retention - 1));
      return requestReports({
        profileIds,
        types: ts,
        source: "backfill",
        paceMs: 120,
        windows: (p) => {
          const end = addDays(todayInTz(p.timezone), -1);
          const wanted = addDays(end, -(d - 1));
          return chunkRange(wanted < earliest ? earliest : wanted, end, 31);
        },
      });
    }),
  ).then((results) =>
    results.reduce<RequestResult>(
      (a, r) => ({ created: a.created + r.created, failed: a.failed + r.failed, errors: [...a.errors, ...r.errors] }),
      { created: 0, failed: 0, errors: [] },
    ),
  );
}

type JobRow = {
  id: string;
  profile_id: string;
  report_type: ReportType;
  start_date: string;
  end_date: string;
  amazon_report_id: string;
  attempts: number;
  created_at: string;
};

export type PollResult = { checked: number; completed: number; failed: number; pending: number; rows: number };

/** Check pending jobs; download + ingest finished ones. Stops at the deadline. */
export async function pollReports(deadline: number): Promise<PollResult> {
  const db = createAdminClient();
  const out: PollResult = { checked: 0, completed: 0, failed: 0, pending: 0, rows: 0 };
  const { data: jobs, error } = await db
    .from("report_jobs")
    .select("id, profile_id, report_type, start_date, end_date, amazon_report_id, attempts, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;

  const profiles = new Map((await loadProfiles()).map((p) => [p.profile_id, p]));

  for (const job of (jobs ?? []) as JobRow[]) {
    if (Date.now() > deadline) {
      out.pending++;
      continue;
    }
    out.checked++;
    const profile = profiles.get(job.profile_id);
    const fail = async (msg: string) => {
      await db
        .from("report_jobs")
        .update({ status: "failed", error: msg.slice(0, 1000), updated_at: new Date().toISOString() })
        .eq("id", job.id);
      out.failed++;
    };
    if (!profile) {
      await fail("Profile disabled or missing");
      continue;
    }
    try {
      const status = await adsRequest<{ status: string; url?: string; failureReason?: string }>(
        profile.account,
        `/reporting/reports/${job.amazon_report_id}`,
        { profileId: job.profile_id },
      );
      if (status.status === "COMPLETED" && status.url) {
        const rows = await ingestReport(job, status.url);
        await db
          .from("report_jobs")
          .update({
            status: "completed",
            rows_ingested: rows,
            error: null,
            attempts: job.attempts + 1,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        out.completed++;
        out.rows += rows;
      } else if (status.status === "FAILED") {
        await fail(status.failureReason ?? "Amazon reported FAILED");
      } else if (Date.now() - Date.parse(job.created_at) > 36 * 3600_000) {
        await fail(`Timed out in status ${status.status}`);
      } else {
        await db
          .from("report_jobs")
          .update({ attempts: job.attempts + 1, updated_at: new Date().toISOString() })
          .eq("id", job.id);
        out.pending++;
      }
    } catch (err) {
      const msg = err instanceof AdsApiError ? `${err.message}: ${err.body.slice(0, 300)}` : String(err);
      if (job.attempts >= 10) await fail(msg);
      else {
        await db
          .from("report_jobs")
          .update({ attempts: job.attempts + 1, error: msg.slice(0, 1000), updated_at: new Date().toISOString() })
          .eq("id", job.id);
        out.pending++;
      }
    }
  }
  return out;
}

async function ingestReport(job: JobRow, url: string): Promise<number> {
  const db = createAdminClient();
  const spec = REPORT_SPECS[job.report_type];
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Report download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const raw = JSON.parse(gunzipSync(buf).toString("utf8")) as Record<string, unknown>[];

  const rows = dedupeRows(
    raw.map((r) => spec.map(r, job.profile_id)),
    spec.keys,
  );
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(spec.table).upsert(rows.slice(i, i + 500), { onConflict: spec.conflict });
    if (error) throw new Error(`Upsert ${spec.table}: ${error.message}`);
  }

  if (spec.table === "campaign_daily") {
    const dims = campaignDimensions(raw, job.profile_id, spec.short);
    // Old backfill windows only fill in missing campaigns — they must not overwrite current name/state.
    const isOld = job.end_date < addDays(new Date().toISOString().slice(0, 10), -3);
    for (let i = 0; i < dims.length; i += 500) {
      const { error } = await db
        .from("campaigns")
        .upsert(dims.slice(i, i + 500), { onConflict: "campaign_id", ignoreDuplicates: isOld });
      if (error) throw new Error(`Upsert campaigns: ${error.message}`);
    }
    const { error } = await db.rpc("refresh_daily_analytics", {
      p_profile: job.profile_id,
      p_from: job.start_date,
      p_to: job.end_date,
    });
    if (error) throw new Error(`refresh_daily_analytics: ${error.message}`);
  }
  return rows.length;
}
