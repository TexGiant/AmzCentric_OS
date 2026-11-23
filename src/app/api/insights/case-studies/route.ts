import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { CASE_STUDY_RULES } from "@/lib/case-study-rules";
import { caseStudyCandidates } from "@/lib/case-studies";

/*
 * GET /api/insights/case-studies — anonymized wins for the case study bot.
 * Authorization: Bearer <INSIGHTS_API_TOKEN>. Read-only. Only brands an admin has marked
 * "anonymized" or "named" in Settings → Brands are included. Every call is audited.
 * Query: days (lookback, 14–120, default 45), limit (1–50, default 10).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const expected = process.env.INSIGHTS_API_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function intParam(url: URL, key: string, fallback: number, min: number, max: number): number | null {
  const raw = url.searchParams.get(key);
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export async function GET(req: Request) {
  if (!process.env.INSIGHTS_API_TOKEN) return NextResponse.json({ ok: false, error: "INSIGHTS_API_TOKEN is not set on the server." }, { status: 503 });
  if (!authorized(req)) {
    await audit({ action: "insights.denied", via: "webhook", target: "case-studies" });
    return NextResponse.json({ ok: false, error: "Missing or wrong token. Send Authorization: Bearer <INSIGHTS_API_TOKEN>." }, { status: 401 });
  }
  const url = new URL(req.url);
  const days = intParam(url, "days", 45, CASE_STUDY_RULES.windowDays, 120);
  const limit = intParam(url, "limit", 10, 1, 50);
  if (days == null || limit == null) return NextResponse.json({ ok: false, error: "days must be 14–120 and limit 1–50 (whole numbers)." }, { status: 400 });

  try {
    const r = await caseStudyCandidates({ days, limit });
    await audit({
      action: "insights.case_studies",
      via: "webhook",
      target: "case-studies",
      detail: { days, limit, returned: r.candidates.length, brands_scanned: r.brandsScanned, ids: r.candidates.map((c) => c.id) },
    });
    return NextResponse.json(
      {
        ok: true,
        generated_at: new Date().toISOString(),
        rules: {
          window_days: CASE_STUDY_RULES.windowDays,
          win_if: `sales/day up ≥ ${CASE_STUDY_RULES.minSalesLift * 100}%, or ACOS down ≥ ${CASE_STUDY_RULES.minAcosDrop * 100} points with sales/day down no more than ${-CASE_STUDY_RULES.maxSalesDropWithAcosWin * 100}%`,
          min_orders_before: CASE_STUDY_RULES.minOrdersBefore,
          lookback_days: days,
        },
        brands_scanned: r.brandsScanned,
        actions_measured: r.actionsMeasured,
        not_qualified: r.notQualified,
        count: r.candidates.length,
        candidates: r.candidates,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("case study feed failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Couldn't build the feed." }, { status: 500 });
  }
}
