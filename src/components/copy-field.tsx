"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonClass, cn } from "@/components/ui";

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex h-10 flex-1 items-center overflow-x-auto rounded-lg border border-line-strong bg-canvas px-3 font-mono text-sm whitespace-nowrap text-ink">{value}</code>
      <button
        type="button"
        className={cn(buttonClass.secondary, "h-10")}
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
      >
        {copied ? <Check strokeWidth={2} /> : <Copy strokeWidth={1.5} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
