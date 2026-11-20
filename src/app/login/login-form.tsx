"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { buttonClass, cn, inputClass, labelClass } from "@/components/ui";

/*
 * A plain HTML form that POSTs to /auth/login. Submitting for real (not via fetch) is what
 * makes Chrome, Safari, Edge and Firefox offer to save the email + password, and lets them
 * autofill it next time. Fields stay enabled while submitting: disabled fields are left out
 * of the submission and ignored by password managers.
 */
export function LoginForm({ next, initialError, initialEmail }: { next: string; initialError?: string; initialEmail?: string }) {
  const [error, setError] = useState(initialError ?? "");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  // Coming back with the Back button restores this page from cache — un-stick the button.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setBusy(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function resetPassword(email: string) {
    if (!email) return setError("Enter your email first.");
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/account/set-password`,
    });
    if (error) setError(error.message);
    else setInfo("Check your email for a reset link.");
  }

  return (
    <form
      method="post"
      action="/auth/login"
      onSubmit={(e) => {
        if (busy) return e.preventDefault(); // no double submit
        setError("");
        setInfo("");
        setBusy(true);
      }}
      className="mt-6 space-y-4"
    >
      <input type="hidden" name="next" value={next} />
      <label className="block" htmlFor="login-email">
        <span className={labelClass}>Work email</span>
        <input
          id="login-email"
          name="email"
          type="email"
          inputMode="email"
          required
          readOnly={busy}
          defaultValue={initialEmail}
          autoFocus={!initialEmail}
          placeholder="you@amzcentric.com"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          className={inputClass}
        />
      </label>
      <label className="block" htmlFor="login-password">
        <span className={labelClass}>Password</span>
        <input
          id="login-password"
          name="password"
          type="password"
          required
          readOnly={busy}
          autoFocus={!!initialEmail}
          placeholder="••••••••••"
          autoComplete="current-password"
          className={inputClass}
        />
      </label>
      {error && <p className="text-xs font-semibold text-bad">{error}</p>}
      {info && <p className="text-xs font-semibold text-good">{info}</p>}
      <button type="submit" className={cn(buttonClass.primary, "h-12 w-full text-base")} aria-disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" strokeWidth={2} />}
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <button
        type="button"
        className="w-full text-center text-xs font-semibold text-brand-ink hover:underline"
        onClick={(e) => resetPassword(String(new FormData(e.currentTarget.form!).get("email") ?? ""))}
      >
        Forgot password?
      </button>
    </form>
  );
}
