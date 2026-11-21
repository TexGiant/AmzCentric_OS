export const dynamic = "force-dynamic";

import { Eyebrow, Logo } from "@/components/ui";
import { ConfirmButton } from "./confirm-button";

/*
 * Where invite and password-reset emails land. Opening this page does NOT use the one-time
 * link: email security scanners open every link in an email, and used to burn invites before
 * people clicked them. The link is only used when the person presses the button (a POST).
 */

const COPY: Record<string, { eyebrow: string; title: string; body: string; button: string }> = {
  invite: {
    eyebrow: "Team invite",
    title: "Welcome to AmzCentric OS",
    body: "You've been added to the AmzCentric team workspace. Set your password to finish setting up your account.",
    button: "Set my password",
  },
  recovery: {
    eyebrow: "Password reset",
    title: "Choose a new password",
    body: "Your AmzCentric admin started a password reset for your account.",
    button: "Choose a new password",
  },
};

const ERRORS: Record<string, { title: string; body: string }> = {
  expired: {
    title: "This link has expired or was already used",
    body: "Each link works once. Ask your AmzCentric admin to send a new one from Settings → Team.",
  },
  not_admin_reset: {
    title: "Password resets go through your admin",
    body: "For security, only an AmzCentric admin can reset passwords. Ask your admin to send you a reset email.",
  },
  domain: { title: "That email can't use AmzCentric OS", body: "Sign in with your AmzCentric work email." },
  invalid: { title: "This link isn't complete", body: "Open the link straight from the email, or ask your admin to send a new one." },
};

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const error = sp.error ? (ERRORS[sp.error] ?? ERRORS.expired) : !sp.token_hash || !sp.type ? ERRORS.invalid : null;
  const copy = COPY[sp.type ?? ""] ?? { eyebrow: "AmzCentric OS", title: "Continue to AmzCentric OS", body: "Press continue to confirm it's you.", button: "Continue" };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12" style={{ background: "var(--hero-gradient)" }}>
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" />
        </div>
        <div className="rounded-[22px] border border-line bg-surface p-8 shadow-[var(--shadow-overlay)]">
          {error ? (
            <>
              <Eyebrow>Link problem</Eyebrow>
              <h1 className="mt-2 font-display text-2xl font-semibold tracking-[-0.01em] text-ink">{error.title}</h1>
              <p className="mt-2 text-sm text-muted">{error.body}</p>
              <a href="/login" className="mt-6 inline-block text-sm font-semibold text-brand-ink hover:underline">
                Go to sign-in →
              </a>
            </>
          ) : (
            <>
              <Eyebrow>{copy.eyebrow}</Eyebrow>
              <h1 className="mt-2 font-display text-2xl font-semibold tracking-[-0.01em] text-ink">{copy.title}</h1>
              <p className="mt-2 text-sm text-muted">{copy.body}</p>
              <form method="post" action="/auth/verify" className="mt-6">
                <input type="hidden" name="token_hash" value={sp.token_hash} />
                <input type="hidden" name="type" value={sp.type} />
                <input type="hidden" name="next" value={sp.next ?? "/account/set-password"} />
                <ConfirmButton label={copy.button} />
              </form>
            </>
          )}
        </div>
        <p className="mt-6 text-center text-xs font-semibold text-navy-700/70">Amazon advertising analytics · AmzCentric OS</p>
      </div>
    </main>
  );
}
