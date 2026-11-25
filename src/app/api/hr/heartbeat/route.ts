import { NextResponse } from "next/server";
import { getAccess } from "@/lib/access";
import { brandFromPath } from "@/lib/hr/policy";
import { findPerson, hrContext } from "@/lib/hr/service";
import { can, canSeeBrand } from "@/lib/rbac";

/*
 * POST /api/hr/heartbeat — sent once a minute by the open app while someone is active
 * (mouse or keyboard in the last few minutes, tab visible). Each counted beat = one minute
 * of app time, attributed to the brand page they're on. Signed-in users only; only people
 * marked "tracked" in Settings → HR are recorded.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await getAccess();
  if (!a) return NextResponse.json({ ok: false }, { status: 401 });
  if (!can(a, "hr.self")) return NextResponse.json({ ok: true, counted: false });
  let path = "";
  try {
    const body = (await req.json()) as { path?: unknown };
    path = typeof body.path === "string" ? body.path.slice(0, 200) : "";
  } catch {
    return NextResponse.json({ ok: false, error: "Send JSON: {\"path\": \"/dashboard/…\"}" }, { status: 400 });
  }
  try {
    const ctx = await hrContext();
    const p = await findPerson(ctx, a.email);
    if (!p?.tracked) return NextResponse.json({ ok: true, counted: false });
    const brand = brandFromPath(path);
    const counted = await ctx.store.beat(a.email, ctx.today, brand && canSeeBrand(a, brand) ? brand : null);
    return NextResponse.json({ ok: true, counted, idle_minutes: ctx.policy.idleMinutes }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("heartbeat failed", e);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
