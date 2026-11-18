import "server-only";
import { DeleteMessageBatchCommand, ReceiveMessageCommand, SQSClient, type Message } from "@aws-sdk/client-sqs";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Amazon Marketing Stream → SQS → Supabase.
 *
 * Stream publishes through SNS into your SQS queue. A message body is either the
 * raw record (raw message delivery on) or an SNS envelope whose `Message` holds it.
 * Traffic/conversion records are hourly *deltas*: we store each one once
 * (keyed by idempotency_id) and SUM per hour at read time.
 */

type Rec = Record<string, unknown>;

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? null : String(v));

function adProductOf(dataset: string): string {
  const p = dataset.slice(0, 2).toUpperCase();
  return p === "SB" || p === "SD" ? p : "SP";
}

/** SP sellers use 7-day attribution; SB/SD report 14-day. Fall back across windows. */
function pick(r: Rec, base: string, prefer: string[]): number {
  for (const w of prefer) {
    const v = r[`${base}_${w}`];
    if (v != null) return num(v);
  }
  return num(r[base]);
}

export function toTrafficRow(r: Rec) {
  const dataset = String(r.dataset_id);
  return {
    idempotency_id: String(r.idempotency_id),
    dataset_id: dataset,
    ad_product: adProductOf(dataset),
    advertiser_id: str(r.advertiser_id),
    marketplace_id: str(r.marketplace_id),
    campaign_id: str(r.campaign_id),
    ad_group_id: str(r.ad_group_id),
    target_id: str(r.keyword_id ?? r.target_id),
    placement: str(r.placement),
    time_window_start: String(r.time_window_start),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    cost: num(r.cost),
  };
}

export function toConversionRow(r: Rec) {
  const dataset = String(r.dataset_id);
  const prefer = adProductOf(dataset) === "SP" ? ["7d", "14d"] : ["14d", "7d"];
  return {
    idempotency_id: String(r.idempotency_id),
    dataset_id: dataset,
    ad_product: adProductOf(dataset),
    advertiser_id: str(r.advertiser_id),
    marketplace_id: str(r.marketplace_id),
    campaign_id: str(r.campaign_id),
    ad_group_id: str(r.ad_group_id),
    target_id: str(r.keyword_id ?? r.target_id),
    placement: str(r.placement),
    time_window_start: String(r.time_window_start),
    sales: pick(r, "attributed_sales", prefer),
    orders: pick(r, "attributed_conversions", prefer),
    units: pick(r, "attributed_units_ordered", prefer),
  };
}

type Parsed =
  | { kind: "traffic"; row: ReturnType<typeof toTrafficRow> }
  | { kind: "conversion"; row: ReturnType<typeof toConversionRow> }
  | { kind: "confirm"; url: string }
  | { kind: "ignored" };

export function parseBody(body: string): Parsed[] {
  let outer: Rec;
  try {
    outer = JSON.parse(body);
  } catch {
    return [{ kind: "ignored" }];
  }
  if (outer.Type === "SubscriptionConfirmation" && typeof outer.SubscribeURL === "string") {
    return [{ kind: "confirm", url: outer.SubscribeURL }];
  }
  let inner: unknown = outer;
  if (outer.Type === "Notification" && typeof outer.Message === "string") {
    try {
      inner = JSON.parse(outer.Message);
    } catch {
      return [{ kind: "ignored" }];
    }
  }
  const records = (Array.isArray(inner) ? inner : [inner]) as Rec[];
  return records.map((r): Parsed => {
    const dataset = typeof r?.dataset_id === "string" ? r.dataset_id : "";
    if (!r?.idempotency_id || !r.time_window_start) return { kind: "ignored" };
    if (dataset.endsWith("-traffic")) return { kind: "traffic", row: toTrafficRow(r) };
    if (dataset.endsWith("-conversion")) return { kind: "conversion", row: toConversionRow(r) };
    return { kind: "ignored" };
  });
}

function isSnsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

function regionFromQueueUrl(url: string): string | undefined {
  return url.match(/sqs[.-]([a-z0-9-]+)\.amazonaws\.com/)?.[1];
}

export type IngestResult = {
  queues: number;
  messages: number;
  traffic: number;
  conversion: number;
  ignored: number;
  confirmed: number;
  errors: string[];
};

export function streamConfigured(): boolean {
  return !!process.env.STREAM_SQS_QUEUE_URLS;
}

export async function ingestStream(deadline: number): Promise<IngestResult> {
  const urls = (process.env.STREAM_SQS_QUEUE_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: IngestResult = { queues: urls.length, messages: 0, traffic: 0, conversion: 0, ignored: 0, confirmed: 0, errors: [] };
  if (!urls.length) return out;

  const db = createAdminClient();
  const clients = new Map<string, SQSClient>();
  const clientFor = (url: string) => {
    const region = process.env.STREAM_AWS_REGION || regionFromQueueUrl(url) || "us-east-1";
    let c = clients.get(region);
    if (!c) {
      c = new SQSClient({
        region,
        credentials:
          process.env.STREAM_AWS_ACCESS_KEY_ID && process.env.STREAM_AWS_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.STREAM_AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.STREAM_AWS_SECRET_ACCESS_KEY,
              }
            : undefined,
      });
      clients.set(region, c);
    }
    return c;
  };

  // Drain each queue until it's empty or we hit the deadline.
  await Promise.all(
    urls.map(async (queueUrl) => {
      const sqs = clientFor(queueUrl);
      while (Date.now() < deadline) {
        let messages: Message[] = [];
        try {
          const res = await sqs.send(
            new ReceiveMessageCommand({
              QueueUrl: queueUrl,
              MaxNumberOfMessages: 10,
              WaitTimeSeconds: 1,
              VisibilityTimeout: 120,
            }),
          );
          messages = res.Messages ?? [];
        } catch (err) {
          out.errors.push(`receive ${queueUrl}: ${String(err)}`);
          return;
        }
        if (!messages.length) return;

        const traffic: ReturnType<typeof toTrafficRow>[] = [];
        const conversion: ReturnType<typeof toConversionRow>[] = [];
        for (const m of messages) {
          for (const p of parseBody(m.Body ?? "")) {
            if (p.kind === "traffic") traffic.push(p.row);
            else if (p.kind === "conversion") conversion.push(p.row);
            else if (p.kind === "confirm" && isSnsUrl(p.url)) {
              await fetch(p.url).catch(() => undefined);
              out.confirmed++;
            } else out.ignored++;
          }
        }

        // Upsert first; delete from SQS only after the write succeeded.
        const writes = [
          traffic.length && db.from("stream_traffic").upsert(traffic, { onConflict: "idempotency_id", ignoreDuplicates: true }),
          conversion.length &&
            db.from("stream_conversion").upsert(conversion, { onConflict: "idempotency_id", ignoreDuplicates: true }),
        ].filter(Boolean);
        const results = await Promise.all(writes);
        const failed = results.find((r) => r && "error" in r && r.error);
        if (failed && failed.error) {
          out.errors.push(`db: ${failed.error.message}`);
          return; // messages become visible again after the timeout and get retried
        }

        out.messages += messages.length;
        out.traffic += traffic.length;
        out.conversion += conversion.length;
        await sqs.send(
          new DeleteMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: messages.map((m, i) => ({ Id: String(i), ReceiptHandle: m.ReceiptHandle! })),
          }),
        );
      }
    }),
  );
  return out;
}

/** https://sqs.us-east-1.amazonaws.com/123456789012/name → arn:aws:sqs:us-east-1:123456789012:name */
export function queueArn(url: string): string | null {
  const m = url.match(/^https:\/\/sqs[.-]([a-z0-9-]+)\.amazonaws\.com\/(\d{12})\/([A-Za-z0-9_.-]+)\/?$/);
  return m ? `arn:aws:sqs:${m[1]}:${m[2]}:${m[3]}` : null;
}

/**
 * Which configured queue receives which dataset. A queue is matched by name
 * (e.g. ".../sp-traffic" → sp-traffic), so name queues after their dataset.
 */
export function streamDestinations(): Record<"sp-traffic" | "sp-conversion", string | null> {
  const urls = (process.env.STREAM_SQS_QUEUE_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const find = (dataset: string) => {
    const url = urls.find((u) => (u.split("/").pop() ?? "").toLowerCase().includes(dataset));
    return url ? queueArn(url) : null;
  };
  return { "sp-traffic": find("sp-traffic"), "sp-conversion": find("sp-conversion") };
}
