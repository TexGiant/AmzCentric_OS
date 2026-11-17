import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/env";
import { backfill } from "@/lib/pipeline/reports";
import { isReportType } from "@/lib/pipeline/report-specs";

export const maxDuration = 300;

/** POST { days: number, profileIds?: string[], types?: ReportType[] } */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isDemoMode()) return NextResponse.json({ error: "Demo mode — connect Supabase first" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { days?: number; profileIds?: string[]; types?: string[] };
  const days = Math.min(95, Math.max(1, Math.round(Number(body.days) || 30)));
  const types = (body.types ?? []).filter(isReportType);
  return NextResponse.json(await backfill(days, body.profileIds, types));
}
