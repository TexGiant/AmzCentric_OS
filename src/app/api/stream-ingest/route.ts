import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { deadlineFrom } from "@/lib/cron";
import { isDemoMode } from "@/lib/env";
import { ingestStream } from "@/lib/stream/sqs";

export const maxDuration = 300;

export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isDemoMode()) return NextResponse.json({ error: "Demo mode — connect Supabase first" }, { status: 400 });
  return NextResponse.json(await ingestStream(deadlineFrom(maxDuration)));
}
