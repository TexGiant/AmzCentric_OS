import "server-only";
import { decryptSecret } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";

export type Region = "NA" | "EU" | "FE";

export const REGIONS: Record<Region, { label: string; authUrl: string; tokenUrl: string; apiHost: string }> = {
  NA: {
    label: "North America",
    authUrl: "https://www.amazon.com/ap/oa",
    tokenUrl: "https://api.amazon.com/auth/o2/token",
    apiHost: "https://advertising-api.amazon.com",
  },
  EU: {
    label: "Europe",
    authUrl: "https://eu.account.amazon.com/ap/oa",
    tokenUrl: "https://api.amazon.co.uk/auth/o2/token",
    apiHost: "https://advertising-api-eu.amazon.com",
  },
  FE: {
    label: "Far East",
    authUrl: "https://apac.account.amazon.com/ap/oa",
    tokenUrl: "https://api.amazon.co.jp/auth/o2/token",
    apiHost: "https://advertising-api-fe.amazon.com",
  },
};

export function isRegion(v: unknown): v is Region {
  return v === "NA" || v === "EU" || v === "FE";
}

export type AdsAccount = { id: string; region: Region; refresh_token: string };

export class AdsApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number };

async function tokenRequest(region: Region, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(REGIONS[region].tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...params,
      client_id: requireEnv("AMAZON_ADS_CLIENT_ID"),
      client_secret: requireEnv("AMAZON_ADS_CLIENT_SECRET"),
    }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new AdsApiError(`LwA token request failed (${res.status})`, res.status, text);
  return JSON.parse(text) as TokenResponse;
}

export function exchangeAuthCode(region: Region, code: string, redirectUri: string) {
  return tokenRequest(region, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

// Access tokens last 60 min. Cache per account for the life of the function instance.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getAccessToken(account: AdsAccount): Promise<string> {
  const hit = tokenCache.get(account.id);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const res = await tokenRequest(account.region, {
    grant_type: "refresh_token",
    refresh_token: decryptSecret(account.refresh_token),
  });
  tokenCache.set(account.id, { token: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 });
  return res.access_token;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  profileId?: string;
  body?: unknown;
  contentType?: string;
  accept?: string;
  accessToken?: string;
};

/** Ads API call with throttling (429) and 5xx retries. */
export async function adsRequest<T>(account: AdsAccount, path: string, opts: RequestOptions = {}): Promise<T> {
  const token = opts.accessToken ?? (await getAccessToken(account));
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Amazon-Advertising-API-ClientId": requireEnv("AMAZON_ADS_CLIENT_ID"),
  };
  if (opts.profileId) headers["Amazon-Advertising-API-Scope"] = opts.profileId;
  if (opts.body !== undefined) headers["Content-Type"] = opts.contentType ?? "application/json";
  if (opts.accept) headers.Accept = opts.accept;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(REGIONS[account.region].apiHost + path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new AdsApiError(`Ads API ${opts.method ?? "GET"} ${path} → ${res.status}`, res.status, text);
    return (text ? JSON.parse(text) : null) as T;
  }
}

export type AmazonProfile = {
  profileId: number;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  accountInfo: { marketplaceStringId: string; id: string; type: string; name: string };
};

export function listProfiles(account: AdsAccount, accessToken?: string) {
  return adsRequest<AmazonProfile[]>(account, "/v2/profiles", { accessToken });
}
