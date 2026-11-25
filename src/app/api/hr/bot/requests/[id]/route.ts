import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { NO_STORE, botGuard, requestJson, serverError } from "@/lib/hr/bot";
import { decide, hrContext, listPeople } from "@/lib/hr/service";

/*
 * GET  /api/hr/bot/requests/{id} — one request with its policy check.
 * POST /api/hr/bot/requests/{id} — body {"action": "approve" | "escalate", "note": "…"}.
 *   approve: only a pending request that fits the policy (checked again here); otherwise 409
 *            with error "outside_policy" and the problems — escalate it instead.
 *   escalate: sends a pending request to Zain (status "escalated"); say why in the note.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await botGuard(req, "request");
  if (denied) return denied;
  const { id } = await params;
  try {
    const ctx = await hrContext();
    const r = await ctx.store.getRequest(id);
    if (!r) return NextResponse.json({ ok: false, error: "Request not found." }, { status: 404, headers: NO_STORE });
    const p = (await listPeople(ctx)).find((x) => x.email === r.email);
    return NextResponse.json({ ok: true, request: await requestJson(ctx, r, p) }, { headers: NO_STORE });
  } catch (e) {
    return serverError("request", e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await botGuard(req, "decide");
  if (denied) return denied;
  const { id } = await params;
  let body: { action?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Send JSON: {"action": "approve" | "escalate", "note": "…"}' }, { status: 400, headers: NO_STORE });
  }
  const action = body.action;
  if (action !== "approve" && action !== "escalate") return NextResponse.json({ ok: false, error: 'action must be "approve" or "escalate"' }, { status: 400, headers: NO_STORE });
  const note = typeof body.note === "string" ? body.note : null;
  if (action === "escalate" && !note?.trim()) return NextResponse.json({ ok: false, error: "Say why in note when escalating." }, { status: 400, headers: NO_STORE });
  try {
    const ctx = await hrContext();
    const res = await decide(ctx, id, action, { kind: "bot" }, note);
    await audit({ action: `hr.bot_${action}`, via: "webhook", target: id, detail: res.ok ? { email: res.request.email, type: res.request.type } : { refused: res.error, problems: res.problems } });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error, problems: res.problems }, { status: res.status, headers: NO_STORE });
    const p = (await listPeople(ctx)).find((x) => x.email === res.request.email);
    return NextResponse.json({ ok: true, request: await requestJson(ctx, res.request, p) }, { headers: NO_STORE });
  } catch (e) {
    return serverError("decide", e);
  }
}
