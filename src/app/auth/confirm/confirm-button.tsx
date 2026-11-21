"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { buttonClass, cn } from "@/components/ui";

export function ConfirmButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (busy) e.preventDefault();
        else setBusy(true);
      }}
      className={cn(buttonClass.primary, "h-12 w-full text-base")}
    >
      {busy && <Loader2 className="size-4 animate-spin" strokeWidth={2} />}
      {busy ? "One moment…" : label}
    </button>
  );
}
