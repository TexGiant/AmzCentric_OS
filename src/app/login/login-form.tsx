"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buttonClass, cn, inputClass, labelClass } from "@/components/ui";

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
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block">
        <span className={labelClass}>Work email</span>
        <input name="email" type="email" required placeholder="you@amzcentric.com" autoComplete="email" className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>Password</span>
        <input name="password" type="password" required placeholder="••••••••••" autoComplete="current-password" className={inputClass} />
      </label>
      {error && <p className="text-xs font-semibold text-bad">{error}</p>}
      {info && <p className="text-xs font-semibold text-good">{info}</p>}
      <button className={cn(buttonClass.primary, "h-12 w-full text-base")} disabled={busy}>
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
