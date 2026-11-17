export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { Eyebrow, Logo } from "@/components/ui";
import { LoginForm } from "./login-form";
import { isDemoMode } from "@/lib/env";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (isDemoMode()) redirect("/dashboard");
  const { next, error } = await searchParams;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12" style={{ background: "var(--hero-gradient)" }}>
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" />
        </div>
        <div className="rounded-[22px] border border-line bg-surface p-8 shadow-[var(--shadow-overlay)]">
          <Eyebrow>Team sign-in</Eyebrow>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-[-0.01em] text-ink">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted">AmzCentric team members only.</p>
          <LoginForm next={next?.startsWith("/") ? next : "/dashboard"} initialError={error} />
        </div>
        <p className="mt-6 text-center text-xs font-semibold text-navy-700/70">Amazon advertising analytics · AmzCentric OS</p>
      </div>
    </main>
  );
}
