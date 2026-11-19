"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/*
 * Thin amber bar across the top of the window while a page change is in flight.
 * Starts on any internal link click (or startNavigation() for router.push),
 * finishes when the URL actually changes.
 */

const listeners = new Set<() => void>();

/** Call before router.push()/replace() so the bar shows for programmatic navigation. */
export function startNavigation() {
  listeners.forEach((fn) => fn());
}

function isInternalNavigation(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.("a");
  if (!a || !a.href || a.target === "_blank" || a.hasAttribute("download")) return false;
  const url = new URL(a.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false; // OAuth redirects etc. leave the app
  return url.pathname + url.search !== window.location.pathname + window.location.search;
}

export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [width, setWidth] = useState(0); // 0 = hidden
  const [visible, setVisible] = useState(false);
  const timers = useRef<number[]>([]);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => {
    const start = () => {
      clear();
      setVisible(true);
      setWidth(8);
      // Ease toward 90% while waiting; never reaches 100% until the page arrives.
      const steps = [
        [50, 30],
        [400, 55],
        [1200, 72],
        [2500, 84],
        [5000, 90],
      ];
      steps.forEach(([ms, w]) => timers.current.push(window.setTimeout(() => setWidth(w), ms)));
      // Safety: never hang forever (e.g. navigation cancelled).
      timers.current.push(window.setTimeout(finish, 20_000));
    };
    const onClick = (e: MouseEvent) => {
      if (isInternalNavigation(e)) start();
    };
    listeners.add(start);
    document.addEventListener("click", onClick, true);
    return () => {
      listeners.delete(start);
      document.removeEventListener("click", onClick, true);
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    clear();
    setWidth(100);
    timers.current.push(window.setTimeout(() => setVisible(false), 250));
    timers.current.push(window.setTimeout(() => setWidth(0), 500));
  };

  // URL changed → the new page is rendering; complete the bar.
  useEffect(() => {
    if (visible) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]">
      <div
        className="h-full bg-brand shadow-[0_0_10px_rgb(248_164_46/0.7)] transition-[width,opacity] duration-300 ease-out"
        style={{ width: `${width}%`, opacity: visible ? 1 : 0 }}
      />
    </div>
  );
}
