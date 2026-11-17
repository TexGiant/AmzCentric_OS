import { NextResponse } from "next/server";
import { deadlineFrom, isCronAuthorized } from "@/lib/cron";
import { ingestStream } from "@/lib/stream/sqs";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await ingestStream(deadlineFrom(maxDuration)));
}
