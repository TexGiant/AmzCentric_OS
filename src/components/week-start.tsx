"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { startNavigation } from "@/components/nav-progress";
import { cn, selectClass } from "@/components/ui";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Which weekday weeks start on; remembered in a cookie so every brand uses it. */
export function WeekStartSelect({ value, cookie }: { value: number; cookie: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold whitespace-nowrap text-muted">
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      Weeks start
      <select
        value={value}
        onChange={(e) => {
          const ws = e.target.value;
          document.cookie = `${cookie}=${ws}; path=/; max-age=31536000; samesite=lax`;
          const q = new URLSearchParams(sp.toString());
          q.set("ws", ws);
          startNavigation();
          start(() => router.push(`${pathname}?${q}`));
        }}
        className={cn(selectClass, "h-[38px] w-auto py-0 pr-8 text-xs font-bold")}
      >
        {DAYS.map((d, i) => (
          <option key={d} value={i}>
            {d}
          </option>
        ))}
      </select>
    </label>
  );
}
