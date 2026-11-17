export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { Logo } from "@/components/ui";
import { LoginForm } from "./login-form";
import { isDemoMode } from "@/lib/env";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (isDemoMode()) redirect("/dashboard");
  const { next, error } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Logo className="mb-8 justify-center" />
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-xl shadow-ink/5">
          <h1 className="text-lg font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-muted">AmzCentric team members only.</p>
          <LoginForm next={next?.startsWith("/") ? next : "/dashboard"} initialError={error} />
        </div>
      </div>
    </main>
  );
}
