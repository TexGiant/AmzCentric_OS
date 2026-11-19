"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/components/ui";

/** Fixed-size spinner inside a <Link>; fades in while that link's navigation is pending. */
export function LinkSpinner({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <Loader2
      aria-hidden
      strokeWidth={2}
      className={cn("size-3.5 shrink-0 animate-spin transition-opacity", pending ? "opacity-100" : "opacity-0", className)}
    />
  );
}

/** Wraps a link's label; pulses while that link's navigation is pending (no layout shift). */
export function LinkPulse({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={cn("transition-opacity", pending && "animate-pulse opacity-60")}>{children}</span>;
}
