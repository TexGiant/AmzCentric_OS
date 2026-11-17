import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron";
import { requestDaily } from "@/lib/pipeline/reports";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await requestDaily());
}
