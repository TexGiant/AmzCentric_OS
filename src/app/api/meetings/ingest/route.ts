import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { detectBrand, matchBrand } from "@/lib/brand-match";
import { demoSource } from "@/lib/data/demo";
import { adminSource } from "@/lib/data/supabase";
import { todayInTz } from "@/lib/dates";
import { isDemoMode, siteUrl } from "@/lib/env";
import { MAX_NOTES_CHARS, analysisEnabled, analyzeMeeting } from "@/lib/meetings/analyze";
import { meetingStore } from "@/lib/meetings/store";
import { audit } from "@/lib/audit";

/*
 * POST /api/meetings/ingest — lets a recorder (via Zapier, Make, n8n or a script) push
 * meeting notes in. Authorization: Bearer <MEETINGS_INGEST_TOKEN>.
 * Body (JSON or form fields): brand?, title?, date?, notes | summary | transcript, external_id?, created_by?
 * When brand is missing it's detected from the title ("Mr. Assist weekly sync").
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const TZ = "America/Los_Angeles";

function authorized(req: Request): boolean {
  const expected = process.env.MEETINGS_INGEST_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : (req.headers.get("x-api-key") ?? "").trim();
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

async function readBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await req.json()) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(body ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)]),
    );
  }
  const form = await req.formData();
  return Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
}

function first(body: Record<string, string>, ...keys: string[]) {
  for (const k of keys) {
    const v = body[k]?.trim();
    if (v) return v;
  }
  return "";
}

function meetingDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const n = Number(raw);
  const d = raw ? new Date(Number.isFinite(n) && n > 1e9 ? (n < 1e12 ? n * 1000 : n) : raw) : new Date();
  return todayInTz(TZ, Number.isNaN(d.getTime()) ? new Date() : d);
}

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status });

export async function GET() {
  return NextResponse.json({ ok: true, configured: Boolean(process.env.MEETINGS_INGEST_TOKEN), analysis: analysisEnabled() });
}

export async function POST(req: Request) {
  if (!process.env.MEETINGS_INGEST_TOKEN) return err(503, "MEETINGS_INGEST_TOKEN is not set on the server.");
  if (!authorized(req)) return err(401, "Missing or wrong token. Send Authorization: Bearer <MEETINGS_INGEST_TOKEN>.");

  let body: Record<string, string>;
  try {
    body = await readBody(req);
  } catch {
    return err(400, "Send JSON or form fields.");
  }

  const summary = first(body, "notes", "summary", "meeting_notes", "overview");
  const transcript = first(body, "transcript", "text", "content");
  const notes = summary && transcript && summary !== transcript ? `${summary}\n\n--- Transcript ---\n${transcript}` : summary || transcript;
  if (notes.length < 20) return err(400, "No notes: send `notes` (or `summary` / `transcript`).");
  if (notes.length > MAX_NOTES_CHARS) return err(413, `Notes are longer than ${MAX_NOTES_CHARS} characters.`);

  const title = first(body, "title", "meeting_title", "name", "subject") || "Weekly call";
  // No user session here, so read brands with the service role.
  const brands = await (isDemoMode() ? demoSource : adminSource).listBrands();
  const brandInput = first(body, "brand", "brand_slug", "client");
  const brand = brandInput ? matchBrand(brands, brandInput).brand : (detectBrand(brands, title) ?? detectBrand(brands, notes.slice(0, 3000)));
  if (!brand) {
    return err(422, brandInput ? `Unknown or ambiguous brand "${brandInput}".` : "Couldn't tell which brand this meeting is for. Send `brand`, or put the brand name in the title.", {
      brands: brands.map((b) => ({ slug: b.slug, name: b.name })),
    });
  }

  const { meeting, duplicate } = await meetingStore().createMeeting({
    brandSlug: brand.slug,
    title: title.slice(0, 200),
    meetingDate: meetingDate(first(body, "date", "meeting_date", "start_time", "started_at")),
    notes,
    source: "webhook",
    externalId: first(body, "external_id", "meeting_id", "id").slice(0, 200) || null,
    createdBy: first(body, "created_by", "organizer_email", "host_email").slice(0, 200) || "recorder",
  });
  if (!duplicate) {
    await audit({ action: "meeting.create", via: "webhook", actorEmail: meeting.createdBy, brand: brand.slug, target: meeting.id, detail: { title: meeting.title } });
    after(() => analyzeMeeting(meeting.id));
  }

  return NextResponse.json(
    {
      ok: true,
      duplicate,
      meeting_id: meeting.id,
      brand: brand.slug,
      url: `${siteUrl()}/dashboard/${brand.slug}/meetings/${meeting.id}`,
      analysis: duplicate ? meeting.status : analysisEnabled() ? "running" : "off (set ANTHROPIC_API_KEY)",
    },
    { status: duplicate ? 200 : 202 },
  );
}
