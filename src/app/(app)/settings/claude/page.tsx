import { Card, CardHeader, Empty, PageHeader, Pill, buttonClass, cn } from "@/components/ui";
import { CopyField } from "@/components/copy-field";
import { disconnectClaude } from "@/app/claude-actions";
import { requireUser } from "@/lib/auth";
import { mcpResource } from "@/lib/oauth";
import { oauthStore } from "@/lib/oauth/store";
import { Bot } from "lucide-react";

const TOOLS: Array<[string, string]> = [
  ["list_brands", "All brands with last-7-day performance"],
  ["get_brand_overview", "Today, yesterday, 7/14/30 days and attention alerts"],
  ["get_what_changed", "Why sales moved: movers, drivers, logged actions"],
  ["get_campaigns", "Campaign performance, filter by SP/SB/SD"],
  ["get_search_terms", "Search terms: wasted spend, winners, harvest"],
  ["get_products", "Advertised ASINs"],
  ["get_hourly", "Hour-by-hour funnel for any day"],
  ["get_action_log", "Logged changes with measured impact"],
  ["get_goals", "Monthly targets and pacing"],
  ["log_action", "Add an entry to the Action Log, as you"],
];

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export default async function ClaudeConnectorPage() {
  const user = await requireUser();
  const connections = await oauthStore().listConnections(user.role === "admin" ? null : user.id);
  const url = mcpResource();

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Claude connector"
        subtitle="Ask Claude about any brand's numbers, and have it log actions for you, from claude.ai, the desktop app or Claude Code."
      />
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Connect" />
          <div className="space-y-6 p-6">
            <div>
              <div className="mb-2 text-sm font-semibold text-ink">Connector URL</div>
              <CopyField value={url} />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">Claude Team or Enterprise</div>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
                <li>
                  A Claude <b>Owner</b> opens <b>Organization settings → Connectors → Add custom connector</b>, names it <b>AmzCentric OS</b> and pastes the URL above. Once.
                </li>
                <li>
                  Each teammate opens <b>Settings → Connectors</b> in Claude, clicks <b>Connect</b> next to AmzCentric OS, and signs in with their AmzCentric OS login.
                </li>
              </ol>
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">Claude Pro or Max</div>
              <p className="mt-1 text-sm text-ink-2">
                <b>Settings → Connectors → Add custom connector</b>, paste the URL, then <b>Connect</b> and sign in.
              </p>
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-ink">Claude Code</div>
              <CopyField value={`claude mcp add --transport http amzcentric ${url}`} />
              <p className="mt-1.5 text-xs text-muted">Then run /mcp in Claude Code and choose Authenticate.</p>
            </div>
            <div className="rounded-xl border border-brand/35 bg-brand-soft px-4 py-3 text-sm text-ink-2">
              Try: <i>&ldquo;Why did Mr. Assist&apos;s sales drop this week?&rdquo;</i> · <i>&ldquo;Show wasted search terms for Dura Cleanse, last 30 days&rdquo;</i> ·{" "}
              <i>&ldquo;Log that I raised Twigglo&apos;s exact bids 15% today&rdquo;</i>
            </div>
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="What Claude can do" sub="Read everything; write only to the Action Log. Nothing in Amazon changes." />
          <ul className="divide-y divide-line">
            {TOOLS.map(([name, desc]) => (
              <li key={name} className="flex items-start gap-3 px-6 py-2.5">
                <code className="mt-0.5 shrink-0 rounded-md bg-canvas px-1.5 py-0.5 font-mono text-xs text-ink">{name}</code>
                <span className="text-sm text-ink-2">{desc}</span>
                {name === "log_action" && (
                  <span className="ml-auto">
                    <Pill tone="brand">writes</Pill>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={user.role === "admin" ? "Active connections (everyone)" : "Your active connections"} />
        {connections.length === 0 ? (
          <Empty icon={<Bot className="size-8" strokeWidth={1.5} />} title="No Claude connections yet">
            Connect from Claude using the steps above. Each connection appears here.
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {connections.map((c) => (
              <li key={c.family} className="flex flex-wrap items-center gap-3 px-6 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink">
                    {c.clientName}
                    {user.role === "admin" && c.email ? <span className="font-normal text-muted"> · {c.email}</span> : null}
                  </div>
                  <div className="text-xs text-muted">
                    Connected {fmt(c.createdAt)} · last used {fmt(c.lastUsedAt)}
                  </div>
                </div>
                <form action={disconnectClaude}>
                  <input type="hidden" name="family" value={c.family} />
                  <button className={cn(buttonClass.danger)}>Disconnect</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
