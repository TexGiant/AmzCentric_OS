import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isDemoMode } from "@/lib/env";
import { backfill } from "@/lib/pipeline/reports";
import { isReportType } from "@/lib/pipeline/report-specs";

export const maxDuration = 300;

/** POST { days: number, profileIds?: string[], types?: ReportType[] } */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ error: "Demo mode — connect Supabase first" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { days?: number; profileIds?: string[]; types?: string[] };
  const days = Math.min(95, Math.max(1, Math.round(Number(body.days) || 30)));
  const types = (body.types ?? []).filter(isReportType);
  await audit({ action: "sync.backfill", actor: { userId: user.id, email: user.email }, detail: { days, profiles: body.profileIds ?? "all", types } });
  return NextResponse.json(await backfill(days, body.profileIds, types));
}
