import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isAllowedEmail, siteUrl } from "@/lib/env";
import { oauthStore, type ClientRow } from "@/lib/oauth/store";

/**
 * Minimal OAuth 2.1 authorization server for the Claude connector:
 * dynamic client registration (RFC 7591), authorization code + PKCE (S256),
 * refresh-token rotation with reuse detection, opaque hashed tokens.
 */

export const SCOPE = "amzcentric";
const CODE_TTL_S = 10 * 60;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
const at = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

export const issuer = () => siteUrl();
export const mcpResource = () => `${siteUrl()}/api/mcp`;
export const resourceMetadataUrl = () => `${siteUrl()}/.well-known/oauth-protected-resource`;

export function authorizationServerMetadata() {
  const base = issuer();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [SCOPE],
  };
}

export function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [issuer()],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "AmzCentric OS",
  };
}

/** Claude's callbacks, local callbacks (Claude Code, MCP Inspector), plus any listed in OAUTH_EXTRA_REDIRECT_URIS. */
export function redirectUriAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  const extra = (process.env.OAUTH_EXTRA_REDIRECT_URIS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (extra.includes(uri)) return true;
  if (u.protocol === "https:" && ["claude.ai", "claude.com"].includes(u.hostname) && u.pathname === "/api/mcp/auth_callback") return true;
  if (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)) return true;
  return false;
}

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// ── Registration ─────────────────────────────────────────────────────────

export async function registerClient(body: Record<string, unknown>) {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === "string")) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris is required");
  }
  const bad = (uris as string[]).find((u) => !redirectUriAllowed(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", `redirect URI not allowed: ${bad}`);
  const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
    throw new OAuthError("invalid_client_metadata", `unsupported token_endpoint_auth_method: ${method}`);
  }
  const clientId = `amz_${randomToken(16)}`;
  const secret = method === "none" ? null : randomToken(32);
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 120) : "Claude";
  await oauthStore().insertClient({
    client_id: clientId,
    client_secret_hash: secret ? sha256(secret) : null,
    client_name: name,
    redirect_uris: uris as string[],
  });
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: method,
    scope: SCOPE,
  };
}

// ── Authorization request (validated before showing the consent screen) ──

export type AuthorizeRequest = {
  client: ClientRow;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string;
  resource: string | null;
};

/** Errors here must NOT redirect: the redirect URI isn't trusted yet. */
export async function validateAuthorizeRequest(p: Record<string, string | undefined>): Promise<AuthorizeRequest> {
  const client = p.client_id ? await oauthStore().getClient(p.client_id) : null;
  if (!client) throw new OAuthError("invalid_client", "Unknown client. Remove the connector in Claude and add it again.");
  const redirectUri = p.redirect_uri ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : "");
  if (!client.redirect_uris.includes(redirectUri)) throw new OAuthError("invalid_request", "Redirect URI doesn't match this client.");
  if (p.response_type !== "code") throw new OAuthError("unsupported_response_type", "Only response_type=code is supported.");
  if (!p.code_challenge || p.code_challenge_method !== "S256") throw new OAuthError("invalid_request", "PKCE with S256 is required.");
  if (p.resource && p.resource.replace(/\/$/, "") !== mcpResource()) {
    throw new OAuthError("invalid_target", `This server only issues tokens for ${mcpResource()}.`);
  }
  return {
    client,
    redirectUri,
    state: p.state ?? null,
    codeChallenge: p.code_challenge,
    scope: SCOPE,
    resource: p.resource ?? mcpResource(),
  };
}

export async function createAuthorizationCode(req: AuthorizeRequest, userId: string): Promise<string> {
  const code = randomToken(32);
  await oauthStore().insertCode({
    code_hash: sha256(code),
    client_id: req.client.client_id,
    user_id: userId,
    redirect_uri: req.redirectUri,
    code_challenge: req.codeChallenge,
    scope: req.scope,
    resource: req.resource,
    expires_at: at(CODE_TTL_S),
  });
  return code;
}

// ── Token endpoint ───────────────────────────────────────────────────────

function pkceOk(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authenticateClient(clientId: string | undefined, secret: string | undefined): Promise<ClientRow> {
  const client = clientId ? await oauthStore().getClient(clientId) : null;
  if (!client) throw new OAuthError("invalid_client", "Unknown client", 401);
  if (client.client_secret_hash) {
    if (!secret || sha256(secret) !== client.client_secret_hash) throw new OAuthError("invalid_client", "Bad client credentials", 401);
  }
  return client;
}

async function issueTokens(clientId: string, userId: string, scope: string | null, resource: string | null, family: string = randomUUID()) {
  const access = randomToken(32);
  const refresh = randomToken(48);
  await oauthStore().insertTokens([
    { token_hash: sha256(access), kind: "access", family, client_id: clientId, user_id: userId, scope, resource, expires_at: at(ACCESS_TTL_S) },
    { token_hash: sha256(refresh), kind: "refresh", family, client_id: clientId, user_id: userId, scope, resource, expires_at: at(REFRESH_TTL_S) },
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scope ?? SCOPE };
}

export async function tokenRequest(form: URLSearchParams, basicAuth: { id: string; secret: string } | null) {
  const client = await authenticateClient(basicAuth?.id ?? form.get("client_id") ?? undefined, basicAuth?.secret ?? form.get("client_secret") ?? undefined);
  const store = oauthStore();
  const grant = form.get("grant_type");

  if (grant === "authorization_code") {
    const code = form.get("code");
    const verifier = form.get("code_verifier");
    if (!code || !verifier) throw new OAuthError("invalid_request", "code and code_verifier are required");
    const row = await store.takeCode(sha256(code));
    if (!row || row.client_id !== client.client_id) throw new OAuthError("invalid_grant", "Invalid or used code");
    if (Date.parse(row.expires_at) < Date.now()) throw new OAuthError("invalid_grant", "Code expired");
    const redirectUri = form.get("redirect_uri");
    if (redirectUri && redirectUri !== row.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri mismatch");
    if (!pkceOk(verifier, row.code_challenge)) throw new OAuthError("invalid_grant", "PKCE verification failed");
    return issueTokens(client.client_id, row.user_id, row.scope, row.resource);
  }

  if (grant === "refresh_token") {
    const token = form.get("refresh_token");
    if (!token) throw new OAuthError("invalid_request", "refresh_token is required");
    const hash = sha256(token);
    const row = await store.getToken(hash);
    if (!row || row.kind !== "refresh" || row.client_id !== client.client_id) throw new OAuthError("invalid_grant", "Invalid refresh token");
    if (row.revoked_at) {
      // A rotated-out refresh token was used again: treat the whole connection as compromised.
      await store.revokeFamily(row.family);
      throw new OAuthError("invalid_grant", "Refresh token already used");
    }
    if (Date.parse(row.expires_at) < Date.now()) throw new OAuthError("invalid_grant", "Refresh token expired");
    if (!(await store.getUser(row.user_id))) throw new OAuthError("invalid_grant", "User no longer has access");
    await store.revokeToken(hash);
    return issueTokens(client.client_id, row.user_id, row.scope, row.resource, row.family);
  }

  throw new OAuthError("unsupported_grant_type", `Unsupported grant_type: ${grant}`);
}

export async function revokeToken(token: string) {
  const store = oauthStore();
  const row = await store.getToken(sha256(token));
  if (row) await store.revokeFamily(row.family);
}

// ── Resource server: verify a bearer token on /api/mcp ────────────────────

export type McpUser = { userId: string; email: string; role: "admin" | "member"; clientId: string; expiresAt: number; token: string };

export async function verifyAccessToken(token: string | null): Promise<McpUser | null> {
  if (!token) return null;
  const store = oauthStore();
  const hash = sha256(token);
  const row = await store.getToken(hash);
  if (!row || row.kind !== "access" || row.revoked_at || Date.parse(row.expires_at) < Date.now()) return null;
  const user = await store.getUser(row.user_id);
  if (!user || !isAllowedEmail(user.email)) return null;
  // Record use at most every few minutes.
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 5 * 60_000) await store.touchToken(hash);
  return { userId: row.user_id, email: user.email, role: user.role, clientId: row.client_id, expiresAt: Math.floor(Date.parse(row.expires_at) / 1000), token };
}
