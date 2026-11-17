"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buttonClass, inputClass } from "@/components/ui";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const router = useRouter();
  const [error, setError] = useState(initialError ?? "");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const { error } = await createClient().auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace(next);
    router.refresh();
  }

  async function resetPassword(email: string) {
    if (!email) return setError("Enter your email first.");
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/account/set-password`,
    });
    if (error) setError(error.message);
    else setInfo("Check your email for a reset link.");
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-3">
      <input name="email" type="email" required placeholder="you@amzcentric.com" autoComplete="email" className={inputClass} />
      <input name="password" type="password" required placeholder="Password" autoComplete="current-password" className={inputClass} />
      {error && <p className="text-xs text-bad">{error}</p>}
      {info && <p className="text-xs text-good">{info}</p>}
      <button className={`${buttonClass.primary} w-full`} disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <button
        type="button"
        className="w-full text-center text-xs text-muted hover:text-ink"
        onClick={(e) => resetPassword(String(new FormData(e.currentTarget.form!).get("email") ?? ""))}
      >
        Forgot password?
      </button>
    </form>
  );
}
