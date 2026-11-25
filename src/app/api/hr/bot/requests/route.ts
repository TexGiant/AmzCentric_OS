import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { NO_STORE, botGuard, requestJson, serverError } from "@/lib/hr/bot";
import { REQUEST_STATUSES, type RequestStatus } from "@/lib/hr/policy";
import { hrContext, listPeople } from "@/lib/hr/service";

/*
 * GET /api/hr/bot/requests?status=pending — leave requests for the HR bot.
 * status: pending (default) | escalated | approved | declined | cancelled | all.
 * days: how far back to look for non-pending statuses (1–120, default 30).
 * Each request includes the policy check (within_policy, problems) and the person's balances.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await botGuard(req, "requests");
  if (denied) return denied;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  if (status !== "all" && !REQUEST_STATUSES.includes(status as RequestStatus))
    return NextResponse.json({ ok: false, error: `status must be one of: ${REQUEST_STATUSES.join(", ")}, all` }, { status: 400, headers: NO_STORE });
  const days = Number(url.searchParams.get("days") ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 120) return NextResponse.json({ ok: false, error: "days must be 1–120" }, { status: 400, headers: NO_STORE });
  try {
    const ctx = await hrContext();
    const people = await listPeople(ctx);
    const byEmail = new Map(people.map((p) => [p.email, p]));
    const waiting = status === "pending" || status === "escalated";
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = (await ctx.store.listRequests({ statuses: status === "all" ? undefined : [status as RequestStatus], limit: 500 })).filter(
      (r) => waiting || r.createdAt >= since || (r.decidedAt ?? "") >= since,
    );
    const requests = await Promise.all(rows.reverse().map((r) => requestJson(ctx, r, byEmail.get(r.email))));
    await audit({ action: "hr.bot_requests", via: "webhook", target: status, detail: { count: requests.length } });
    return NextResponse.json({ ok: true, today: ctx.today, timezone: ctx.policy.timezone, count: requests.length, requests }, { headers: NO_STORE });
  } catch (e) {
    return serverError("requests", e);
  }
}
