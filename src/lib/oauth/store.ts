import "server-only";
import { demoUser } from "@/lib/demo-users";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/** Persistence for the Claude connector's OAuth flow (Supabase, or in-memory in demo mode). */

export type ClientRow = {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  redirect_uris: string[];
  created_at?: string;
};
export type CodeRow = {
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string | null;
  resource: string | null;
  expires_at: string;
};
export type TokenRow = {
  token_hash: string;
  kind: "access" | "refresh";
  family: string;
  client_id: string;
  user_id: string;
  scope: string | null;
  resource: string | null;
  expires_at: string;
  revoked_at?: string | null;
  last_used_at?: string | null;
  created_at?: string;
};
export type Connection = {
  family: string;
  clientName: string;
  userId: string;
  email: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

export interface OAuthStore {
  insertClient(row: ClientRow): Promise<void>;
  getClient(clientId: string): Promise<ClientRow | null>;
  insertCode(row: CodeRow): Promise<void>;
  /** Returns the code and deletes it (single use). */
  takeCode(codeHash: string): Promise<CodeRow | null>;
  insertTokens(rows: TokenRow[]): Promise<void>;
  getToken(tokenHash: string): Promise<TokenRow | null>;
  revokeToken(tokenHash: string): Promise<void>;
  revokeFamily(family: string): Promise<void>;
  touchToken(tokenHash: string): Promise<void>;
  getUser(userId: string): Promise<{ email: string; role: "admin" | "member" } | null>;
  listConnections(userId: string | null): Promise<Connection[]>;
}

const now = () => new Date().toISOString();

function supabaseStore(): OAuthStore {
  const db = () => createAdminClient();
  const check = (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
  };
  return {
    async insertClient(row) {
      check((await db().from("oauth_clients").insert(row)).error);
    },
    async getClient(id) {
      const { data } = await db().from("oauth_clients").select("*").eq("client_id", id).maybeSingle();
      return (data as ClientRow) ?? null;
    },
    async insertCode(row) {
      check((await db().from("oauth_codes").insert(row)).error);
    },
    async takeCode(hash) {
      const { data } = await db().from("oauth_codes").delete().eq("code_hash", hash).select().maybeSingle();
      return (data as CodeRow) ?? null;
    },
    async insertTokens(rows) {
      check((await db().from("oauth_tokens").insert(rows)).error);
    },
    async getToken(hash) {
      const { data } = await db().from("oauth_tokens").select("*").eq("token_hash", hash).maybeSingle();
      return (data as TokenRow) ?? null;
    },
    async revokeToken(hash) {
      await db().from("oauth_tokens").update({ revoked_at: now() }).eq("token_hash", hash);
    },
    async revokeFamily(family) {
      await db().from("oauth_tokens").update({ revoked_at: now() }).eq("family", family).is("revoked_at", null);
    },
    async touchToken(hash) {
      await db().from("oauth_tokens").update({ last_used_at: now() }).eq("token_hash", hash);
    },
    async getUser(userId) {
      const { data } = await db().auth.admin.getUserById(userId);
      if (!data.user?.email) return null;
      const { data: row } = await db().from("app_users").select("user_id").eq("user_id", userId).maybeSingle();
      if (!row) return null; // removed from the team
      const { data: roles } = await db().from("user_roles").select("role").eq("user_id", userId);
      return { email: data.user.email, role: (roles ?? []).some((r: { role: string }) => r.role === "admin") ? "admin" : "member" };
    },
    async listConnections(userId) {
      let q = db()
        .from("oauth_tokens")
        .select("family, user_id, created_at, last_used_at, kind, oauth_clients(client_name)")
        .eq("kind", "refresh")
        .is("revoked_at", null)
        .gt("expires_at", now())
        .order("created_at", { ascending: false });
      if (userId) q = q.eq("user_id", userId);
      const { data } = await q;
      const { data: users } = await db().from("app_users").select("user_id, email");
      const emails = new Map((users ?? []).map((u) => [u.user_id as string, u.email as string]));
      const seen = new Set<string>();
      const out: Connection[] = [];
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const family = r.family as string;
        if (seen.has(family)) continue;
        seen.add(family);
        const client = (Array.isArray(r.oauth_clients) ? r.oauth_clients[0] : r.oauth_clients) as { client_name?: string } | null;
        out.push({
          family,
          clientName: client?.client_name || "Claude",
          userId: r.user_id as string,
          email: emails.get(r.user_id as string) ?? null,
          createdAt: r.created_at as string,
          lastUsedAt: (r.last_used_at as string) ?? null,
        });
      }
      return out;
    },
  };
}

// Demo mode: in-memory, lives as long as the server process. For local testing only.
const g = globalThis as unknown as { __amzOAuthDemo?: { clients: Map<string, ClientRow>; codes: Map<string, CodeRow>; tokens: Map<string, TokenRow> } };
function memoryStore(): OAuthStore {
  g.__amzOAuthDemo ??= { clients: new Map(), codes: new Map(), tokens: new Map() };
  const m = g.__amzOAuthDemo;
  return {
    async insertClient(row) {
      m.clients.set(row.client_id, { ...row, created_at: now() });
    },
    async getClient(id) {
      return m.clients.get(id) ?? null;
    },
    async insertCode(row) {
      m.codes.set(row.code_hash, row);
    },
    async takeCode(hash) {
      const row = m.codes.get(hash) ?? null;
      m.codes.delete(hash);
      return row;
    },
    async insertTokens(rows) {
      rows.forEach((r) => m.tokens.set(r.token_hash, { ...r, revoked_at: null, created_at: now() }));
    },
    async getToken(hash) {
      return m.tokens.get(hash) ?? null;
    },
    async revokeToken(hash) {
      const t = m.tokens.get(hash);
      if (t) t.revoked_at = now();
    },
    async revokeFamily(family) {
      m.tokens.forEach((t) => {
        if (t.family === family && !t.revoked_at) t.revoked_at = now();
      });
    },
    async touchToken(hash) {
      const t = m.tokens.get(hash);
      if (t) t.last_used_at = now();
    },
    async getUser(userId) {
      const u = demoUser(userId);
      return { email: u.email, role: u.roles.includes("admin") ? "admin" : "member" };
    },
    async listConnections(userId) {
      const seen = new Map<string, Connection>();
      m.tokens.forEach((t) => {
        if (t.kind !== "refresh" || t.revoked_at || seen.has(t.family)) return;
        if (userId && t.user_id !== userId) return;
        seen.set(t.family, {
          family: t.family,
          clientName: m.clients.get(t.client_id)?.client_name || "Claude",
          userId: t.user_id,
          email: demoUser(t.user_id).email,
          createdAt: t.created_at ?? now(),
          lastUsedAt: t.last_used_at ?? null,
        });
      });
      return [...seen.values()];
    },
  };
}

export function oauthStore(): OAuthStore {
  return isDemoMode() ? memoryStore() : supabaseStore();
}
