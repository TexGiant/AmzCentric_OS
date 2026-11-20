import { CheckCircle2, XCircle } from "lucide-react";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { CopyField } from "@/components/copy-field";
import { requireUser } from "@/lib/auth";
import { data } from "@/lib/data";
import { siteUrl } from "@/lib/env";
import { analysisEnabled } from "@/lib/meetings/analyze";

function Check({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <div className="flex gap-3">
      {ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-good" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-bad" />}
      <div>
        <div className="text-sm font-bold text-ink">{label}</div>
        <div className="text-xs text-muted">{hint}</div>
      </div>
    </div>
  );
}

export default async function MeetingSettingsPage() {
  await requireUser();
  const url = `${siteUrl()}/api/meetings/ingest`;
  const brands = await data().listBrands();
  const example = brands[0]?.slug ?? "mr-assist";
  const curl = `curl -X POST ${url} \\
  -H "Authorization: Bearer $MEETINGS_INGEST_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"brand":"${example}","title":"Weekly call","date":"2026-11-20","notes":"- Client approved 20% coupon\\n- Ali to cut broad bids 15% by Friday"}'`;

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Meeting capture"
        subtitle="Turn weekly brand meetings into summaries, insights and tasks — pasted, saved from Claude, or pushed by your recorder."
      />
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          <Card>
            <CardHeader title="Status" />
            <div className="space-y-4 p-6">
              <Check
                ok={analysisEnabled()}
                label="Automatic insights (ANTHROPIC_API_KEY)"
                hint="Create a key at platform.claude.com → API keys, add it in Vercel → Settings → Environment Variables as ANTHROPIC_API_KEY, then redeploy. Without it, pasted notes are saved but not analyzed (saving from Claude still works — Claude writes the insights itself)."
              />
              <Check
                ok={Boolean(process.env.MEETINGS_INGEST_TOKEN)}
                label="Recorder webhook (MEETINGS_INGEST_TOKEN)"
                hint="Any long random string, e.g. from `openssl rand -hex 32`. Add it in Vercel as MEETINGS_INGEST_TOKEN and redeploy. Only needed for Zapier / recorder pushes."
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Zapier: recorder → AmzCentric OS" />
            <div className="space-y-5 p-6 text-sm text-ink-2">
              <div>
                <div className="mb-2 font-semibold text-ink">Webhook URL</div>
                <CopyField value={url} />
              </div>
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  <b>Trigger:</b> your recorder&apos;s “New meeting / transcript ready” event (Fireflies, Otter, Fathom, tl;dv, Zoom, or Google Drive “New file in folder” for Gemini notes).
                </li>
                <li>
                  <b>Action:</b> <b>Webhooks by Zapier → POST</b>. URL above, payload type <b>JSON</b>.
                </li>
                <li>
                  <b>Data:</b> <code>title</code> → meeting title, <code>notes</code> → summary / notes, <code>transcript</code> → transcript (optional), <code>date</code> → meeting date,{" "}
                  <code>external_id</code> → meeting ID (stops duplicates). Add <code>brand</code> if the title doesn&apos;t contain the brand name.
                </li>
                <li>
                  <b>Headers:</b> <code>Authorization</code> = <code>Bearer &lt;your MEETINGS_INGEST_TOKEN&gt;</code>.
                </li>
                <li>Test the step. The meeting appears under the brand&apos;s Meetings tab within a minute, with tasks created.</li>
              </ol>
              <p className="text-xs text-muted">
                Brand detection: if <code>brand</code> is empty, the brand is matched from the meeting title, so naming calendar events like “Mr. Assist × AmzCentric weekly” is enough.
              </p>
            </div>
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="From Claude (no setup)" />
            <div className="space-y-2 p-6 text-sm text-ink-2">
              <p>With the AmzCentric OS connector on, after Claude records or summarizes a call, say:</p>
              <p className="rounded-lg bg-canvas px-3 py-2 font-semibold text-ink">“Save this meeting to AmzCentric OS for {brands[0]?.name ?? "Mr. Assist"} and create the tasks.”</p>
              <p className="text-xs text-muted">Claude saves the notes, insights and tasks under your name. Ask “what are my open tasks?” any time.</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Test with curl" />
            <pre className="overflow-x-auto p-6 font-mono text-[11.5px] leading-relaxed whitespace-pre text-ink-2">{curl}</pre>
          </Card>
        </div>
      </div>
    </>
  );
}
