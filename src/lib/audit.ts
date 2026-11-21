import "server-only";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Audit log: sign-ins, access changes, exports, connector tool calls and every write.
 * Writing never breaks the action being logged; a failure is reported to the server log.
 */

export type AuditVia = "app" | "connector" | "webhook" | "system";
export type AuditEvent = {
  action: string;
  actor?: { userId: string; email: string } | null;
  /** When there's no signed-in person (failed sign-in, webhook). */
  actorEmail?: string | null;
  brand?: string | null;
  target?: string | null;
  via?: AuditVia;
  detail?: Record<string, unknown>;
};
export type AuditRow = {
  id: number;
  at: string;
  actorEmail: string | null;
  action: string;
  brand: string | null;
  target: string | null;
  via: AuditVia;
  detail: Record<string, unknown>;
};

const g = globalThis as unknown as { __amzAudit?: AuditRow[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keep only JSON values (drops functions, class instances, cycles) so a row can always be stored and shown. */
function plainJson(v: Record<string, unknown>): Record<string, unknown> {
  try {
    const seen = new WeakSet<object>();
    return JSON.parse(
      JSON.stringify(v, (_k, x) => {
        if (typeof x === "function" || typeof x === "symbol" || typeof x === "bigint") return undefined;
        if (x && typeof x === "object") {
          if (seen.has(x)) return undefined;
          seen.add(x);
          const proto = Object.getPrototypeOf(x);
          if (!Array.isArray(x) && proto !== Object.prototype && proto !== null) return String(x);
        }
        return x;
      }),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function audit(e: AuditEvent): Promise<void> {
  const row = {
    actor_id: e.actor?.userId && UUID.test(e.actor.userId) ? e.actor.userId : null,
    actor_email: (e.actor?.email ?? e.actorEmail ?? null)?.toLowerCase() ?? null,
    action: e.action,
    brand_slug: e.brand ?? null,
    target: e.target?.slice(0, 300) ?? null,
    via: e.via ?? "app",
    detail: plainJson(e.detail ?? {}),
  };
  try {
    if (isDemoMode()) {
      const log = (g.__amzAudit ??= []);
      log.unshift({ id: log.length + 1, at: new Date().toISOString(), actorEmail: row.actor_email, action: row.action, brand: row.brand_slug, target: row.target, via: row.via, detail: row.detail });
      if (log.length > 5000) log.length = 5000;
      return;
    }
    const { error } = await createAdminClient().from("audit_log").insert(row);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("audit log write failed", e.action, err);
  }
}

export type AuditFilter = { actor?: string; action?: string; brand?: string; via?: string; from?: string; to?: string; limit?: number };

export async function listAudit(f: AuditFilter): Promise<AuditRow[]> {
  const limit = Math.min(f.limit ?? 300, 2000);
  if (isDemoMode()) {
    return (g.__amzAudit ?? [])
      .filter(
        (r) =>
          (!f.actor || r.actorEmail === f.actor.toLowerCase()) &&
          (!f.action || r.action.startsWith(f.action)) &&
          (!f.brand || r.brand === f.brand) &&
          (!f.via || r.via === f.via) &&
          (!f.from || r.at.slice(0, 10) >= f.from) &&
          (!f.to || r.at.slice(0, 10) <= f.to),
      )
      .slice(0, limit);
  }
  let q = createAdminClient().from("audit_log").select("*").order("at", { ascending: false }).limit(limit);
  if (f.actor) q = q.eq("actor_email", f.actor.toLowerCase());
  if (f.action) q = q.like("action", `${f.action}%`);
  if (f.brand) q = q.eq("brand_slug", f.brand);
  if (f.via) q = q.eq("via", f.via);
  if (f.from) q = q.gte("at", `${f.from}T00:00:00Z`);
  if (f.to) q = q.lte("at", `${f.to}T23:59:59Z`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    at: String(r.at),
    actorEmail: (r.actor_email as string) ?? null,
    action: String(r.action),
    brand: (r.brand_slug as string) ?? null,
    target: (r.target as string) ?? null,
    via: r.via as AuditVia,
    detail: (r.detail as Record<string, unknown>) ?? {},
  }));
}
