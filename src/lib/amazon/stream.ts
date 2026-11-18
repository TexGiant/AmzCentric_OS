import "server-only";
import { createHash } from "node:crypto";
import { adsRequest, AdsApiError, type AdsAccount } from "@/lib/amazon/ads";

/**
 * Amazon Marketing Stream subscriptions (Ads API /streams/subscriptions).
 * A subscription links one advertising profile + one dataset to an SQS queue.
 */

// Current media type, with the older one as a fallback if Amazon rejects it.
const MEDIA_TYPES = [
  "application/vnd.amazonmarketingstreamsubscriptions.v1+json",
  "application/vnd.MarketingStreamSubscriptions.StreamSubscriptionResource.v1.0+json",
];

export const STREAM_DATASETS = ["sp-traffic", "sp-conversion", "sb-traffic", "sb-conversion", "sd-traffic", "sd-conversion"] as const;
export type StreamDataset = (typeof STREAM_DATASETS)[number];

export type StreamSubscription = {
  subscriptionId: string;
  dataSetId: string;
  destinationArn?: string;
  status?: string;
  notes?: string;
  createdDate?: string;
};

async function withMediaFallback<T>(fn: (mediaType: string) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (const mt of MEDIA_TYPES) {
    try {
      return await fn(mt);
    } catch (err) {
      lastErr = err;
      if (err instanceof AdsApiError && (err.status === 406 || err.status === 415)) continue;
      throw err;
    }
  }
  throw lastErr;
}

export async function listStreamSubscriptions(account: AdsAccount, profileId: string): Promise<StreamSubscription[]> {
  const out: StreamSubscription[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const qs = nextToken ? `?${new URLSearchParams({ nextToken })}` : "";
    const res = await withMediaFallback((mt) =>
      adsRequest<{ subscriptions?: StreamSubscription[]; nextToken?: string }>(account, `/streams/subscriptions${qs}`, {
        profileId,
        accept: mt,
      }),
    );
    out.push(...(res?.subscriptions ?? []));
    nextToken = res?.nextToken;
    if (!nextToken) break;
  }
  return out;
}

/** Deterministic 32-char token, so retrying the same subscribe is idempotent on Amazon's side. */
function requestToken(profileId: string, dataset: string, destinationArn: string): string {
  return createHash("sha256").update(`${profileId}|${dataset}|${destinationArn}`).digest("hex").slice(0, 32);
}

export async function createStreamSubscription(
  account: AdsAccount,
  profileId: string,
  dataSetId: StreamDataset,
  destinationArn: string,
): Promise<string> {
  const res = await withMediaFallback((mt) =>
    adsRequest<{ subscriptionId: string }>(account, "/streams/subscriptions", {
      method: "POST",
      profileId,
      contentType: mt,
      accept: mt,
      body: {
        dataSetId,
        destinationArn,
        clientRequestToken: requestToken(profileId, dataSetId, destinationArn),
        notes: "AmzCentric OS",
      },
    }),
  );
  return res.subscriptionId;
}

/** Live = points at our queue and isn't archived/failed. */
export function isLive(sub: StreamSubscription): boolean {
  const s = (sub.status ?? "").toUpperCase();
  return !["ARCHIVED", "FAILED", "FAILED_CONFIRMATION", "SUSPENDED"].includes(s);
}
