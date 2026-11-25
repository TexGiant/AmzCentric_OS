import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { bearerMatches } from "@/lib/bearer";
import { validDateTime } from "@/lib/hr/policy";
import { hrStore } from "@/lib/hr/store";

/*
 * POST /api/hr/punches — the office fingerprint machine's punches, sent by the bridge script
 * (tools/attendance-bridge) on a PC in the office. Authorization: Bearer <ATTENDANCE_TOKEN>.
 * Body: {"device": "K50", "punches": [{"user_id": "1", "time": "2026-11-24 09:02:11"}],
 *        "users": [{"user_id": "1", "name": "…"}]}
 * Times are the machine's local time. Re-sending the same punches is harmless (duplicates are ignored).
 */

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const ID = /^[0-9A-Za-z_-]{1,24}$/;
const MAX = 5000;

export async function POST(req: Request) {
  if (!process.env.ATTENDANCE_TOKEN) return NextResponse.json({ ok: false, error: "ATTENDANCE_TOKEN is not set on the server." }, { status: 503, headers: NO_STORE });
  if (!bearerMatches(req, "ATTENDANCE_TOKEN")) {
    await audit({ action: "hr.punches_denied", via: "webhook", target: "punches" });
    return NextResponse.json({ ok: false, error: "Missing or wrong token. Send Authorization: Bearer <ATTENDANCE_TOKEN>." }, { status: 401, headers: NO_STORE });
  }
  let body: { device?: unknown; punches?: unknown; users?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Send JSON with a punches array." }, { status: 400, headers: NO_STORE });
  }
  const list = Array.isArray(body.punches) ? body.punches : [];
  if (list.length > MAX) return NextResponse.json({ ok: false, error: `Send at most ${MAX} punches per request.` }, { status: 413, headers: NO_STORE });
  const device = typeof body.device === "string" ? body.device.slice(0, 60) : null;

  let bad = 0;
  const punches: Array<{ deviceUserId: string; date: string; time: string }> = [];
  for (const raw of list) {
    const p = raw as { user_id?: unknown; time?: unknown };
    const id = String(p?.user_id ?? "");
    const [date = "", time = ""] = typeof p?.time === "string" ? p.time.trim().split(/[ T]/) : [];
    if (!ID.test(id) || !validDateTime(date, time)) {
      bad++;
      continue;
    }
    punches.push({ deviceUserId: id, date, time: time.length === 5 ? `${time}:00` : time.slice(0, 8) });
  }
  const users = (Array.isArray(body.users) ? body.users : [])
    .slice(0, 2000)
    .map((u) => u as { user_id?: unknown; name?: unknown })
    .filter((u) => ID.test(String(u?.user_id ?? "")))
    .map((u) => ({ deviceUserId: String(u.user_id), name: typeof u.name === "string" ? u.name.trim().slice(0, 80) || null : null }));

  try {
    const store = hrStore();
    const added = punches.length ? await store.addPunches(punches, "bridge", device) : 0;
    if (users.length) await store.saveDeviceUsers(users);
    await audit({ action: "hr.punches_ingest", via: "webhook", target: device ?? "bridge", detail: { received: list.length, added, invalid: bad, users: users.length } });
    return NextResponse.json({ ok: true, received: list.length, added, invalid: bad, users: users.length }, { headers: NO_STORE });
  } catch (e) {
    console.error("punch ingest failed", e);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
