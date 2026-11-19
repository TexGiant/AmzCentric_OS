"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Card, Empty, buttonClass } from "@/components/ui";

/** Branded error screen for any dashboard or settings page, with a retry. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card>
      <Empty icon={<AlertTriangle className="size-8" strokeWidth={1.5} />} title="This page couldn’t load">
        The data took too long or something went wrong on our side. Try again; if it keeps happening, send the account lead
        this reference{error.digest ? <> : <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-xs text-ink">{error.digest}</code></> : "."}
        <div className="mt-5 flex justify-center">
          <button onClick={reset} className={buttonClass.primary}>
            <RotateCw strokeWidth={1.5} /> Try again
          </button>
        </div>
      </Empty>
    </Card>
  );
}
