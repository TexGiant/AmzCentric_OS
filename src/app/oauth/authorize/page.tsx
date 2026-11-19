import { redirect } from "next/navigation";
import { Ban, BookOpen, PenLine, ShieldCheck } from "lucide-react";
import { Eyebrow, Logo, buttonClass, cn } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { OAuthError, validateAuthorizeRequest } from "@/lib/oauth";
import { decideAuthorization } from "./actions";

export const dynamic = "force-dynamic";

const KEYS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const params = Object.fromEntries(KEYS.map((k) => [k, typeof sp[k] === "string" ? (sp[k] as string) : undefined]));

  let error: string | null = null;
  let clientName = "Claude";
  try {
    const req = await validateAuthorizeRequest(params);
    clientName = req.client.client_name || "Claude";
  } catch (err) {
    error = err instanceof OAuthError ? err.message : "This connection request is invalid.";
  }

  const user = error ? null : await getUser();
  if (!error && !user) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12" style={{ background: "var(--hero-gradient)" }}>
      <div className="w-full max-w-[460px]">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" />
        </div>
        <div className="rounded-[22px] border border-line bg-surface p-8 shadow-[var(--shadow-overlay)]">
          {error ? (
            <>
              <Eyebrow>Connection problem</Eyebrow>
              <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Can&apos;t connect</h1>
              <p className="mt-2 text-sm text-muted">{error}</p>
            </>
          ) : (
            <>
              <Eyebrow>Connect Claude</Eyebrow>
              <h1 className="mt-2 font-display text-2xl font-semibold tracking-[-0.01em] text-ink">{clientName} wants to use AmzCentric OS</h1>
              <p className="mt-1.5 text-sm text-muted">
                Signed in as <span className="font-semibold text-ink">{user!.email}</span>
              </p>
              <ul className="mt-6 space-y-3.5 text-sm text-ink-2">
                <li className="flex gap-3">
                  <BookOpen className="mt-0.5 size-[18px] shrink-0 text-brand-ink" strokeWidth={1.5} />
                  Read every brand&apos;s dashboards: campaigns, search terms, hourly, products, goals and the Action Log
                </li>
                <li className="flex gap-3">
                  <PenLine className="mt-0.5 size-[18px] shrink-0 text-brand-ink" strokeWidth={1.5} />
                  Add entries to the Action Log under your name
                </li>
                <li className="flex gap-3">
                  <Ban className="mt-0.5 size-[18px] shrink-0 text-muted" strokeWidth={1.5} />
                  It can&apos;t change anything in Amazon
                </li>
              </ul>
              <form action={decideAuthorization} className="mt-7 flex gap-3">
                {Object.entries(params).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
                <button name="decision" value="allow" className={cn(buttonClass.primary, "h-11 flex-1")}>
                  <ShieldCheck strokeWidth={1.5} /> Allow
                </button>
                <button name="decision" value="deny" className={cn(buttonClass.secondary, "h-11")}>
                  Cancel
                </button>
              </form>
              <p className="mt-4 text-xs text-faint">You can disconnect any time from Settings → Claude connector.</p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
