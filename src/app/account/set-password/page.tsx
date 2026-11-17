"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo, buttonClass, inputClass } from "@/components/ui";

export default function SetPasswordPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== String(form.get("confirm"))) return setError("Passwords don't match.");
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Logo className="mb-8 justify-center" />
        <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-line bg-surface p-6 shadow-xl shadow-ink/5">
          <h1 className="text-lg font-semibold text-ink">Set your password</h1>
          <p className="text-sm text-muted">Welcome to AmzCentric OS. Choose a password to finish setting up your account.</p>
          <input name="password" type="password" placeholder="New password" autoComplete="new-password" className={inputClass} required />
          <input name="confirm" type="password" placeholder="Confirm password" autoComplete="new-password" className={inputClass} required />
          {error && <p className="text-xs text-bad">{error}</p>}
          <button className={`${buttonClass.primary} w-full`} disabled={busy}>
            {busy ? "Saving…" : "Save and continue"}
          </button>
        </form>
      </div>
    </main>
  );
}
