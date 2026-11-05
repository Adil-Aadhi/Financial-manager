"use client";

/**
 * TEMPORARY navigation timing overlay (Step 3, Phase 0). Remove once Step 3 is done.
 *
 * Turn on:  localStorage.ftPerf = "1"  then reload.   Turn off: delete localStorage.ftPerf
 *
 * Kept light for iPhone Safari: renders nothing and installs no listeners unless enabled,
 * uses no backdrop blur, and only re-renders when a timing is recorded.
 */

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  clearPerfLog,
  getApproximateCount,
  getPerfEntries,
  isPerfEnabled,
  markRouteShown,
  markRscDuration,
  startNavigation,
  subscribePerf,
  type PerfEntry,
} from "@/lib/perf";

const noopSubscribe = () => () => {};

export function PerfOverlay() {
  const enabled = useSyncExternalStore(noopSubscribe, isPerfEnabled, () => false);
  return enabled ? <PerfOverlayInner /> : null;
}

function PerfOverlayInner() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const entries = useSyncExternalStore(subscribePerf, getPerfEntries, getPerfEntries);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      startNavigation(url.pathname, event.timeStamp);
    };
    document.addEventListener("click", onClick, true);

    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const url = new URL(entry.name);
          if (url.origin === window.location.origin && url.searchParams.has("_rsc")) {
            markRscDuration(url.pathname, entry.startTime, entry.duration);
          }
        }
      });
      observer.observe({ type: "resource" });
    } catch {
      observer = null;
    }

    return () => {
      document.removeEventListener("click", onClick, true);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    markRouteShown(pathname);
  }, [pathname]);

  const navs = entries.filter((entry) => entry.kind === "nav");
  const recent = entries.slice(-6).reverse();

  const copy = async () => {
    const text = JSON.stringify(entries, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      console.log("ftPerf log:", text);
    }
  };

  return (
    <aside
      aria-label="Navigation timings (debug)"
      className="pointer-events-auto fixed left-2 top-[calc(env(safe-area-inset-top)+4.75rem)] z-[60] w-[13.5rem] rounded-xl border border-line bg-canvas/95 p-2 font-mono text-[10px] leading-tight text-fg shadow-glass"
    >
      <div className="flex items-center justify-between gap-1">
        <button type="button" onClick={() => setCollapsed((value) => !value)} className="font-semibold text-fg">
          perf {collapsed ? "▸" : "▾"}
        </button>
        <span className="text-fg-subtle">
          route {median(navs, "routeMs")} · local {median(navs, "localMs")}
        </span>
      </div>
      {!collapsed && (
        <>
          <p className="mt-1 text-fg-subtle">ms from tap · median of {navs.length}</p>
          <ul className="mt-1 space-y-0.5">
            {recent.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-1">
                <span className="truncate text-fg-muted">
                  {entry.kind === "load" ? "⟳" : "→"}
                  {entry.path}
                </span>
                <span className="shrink-0">
                  {fmt(entry.routeMs)}/{fmt(entry.localMs)}
                  {entry.rscMs !== undefined && <span className="text-fg-subtle"> r{entry.rscMs}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-fg-subtle">route/local · r = RSC request · ⟳ = page load</p>
          {getApproximateCount() > 0 && (
            <p className="mt-0.5 text-warning">≈{getApproximateCount()} timed without a painted frame</p>
          )}
          <div className="mt-1.5 flex gap-1.5">
            <button type="button" onClick={copy} className="rounded border border-line px-1.5 py-0.5 text-fg-muted">
              {copied ? "copied" : "copy"}
            </button>
            <button type="button" onClick={clearPerfLog} className="rounded border border-line px-1.5 py-0.5 text-fg-muted">
              clear
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

function fmt(value?: number) {
  return value === undefined ? "–" : String(value);
}

function median(list: PerfEntry[], key: "routeMs" | "localMs") {
  const values = list.map((entry) => entry[key]).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
  if (!values.length) return "–";
  return String(values[Math.floor(values.length / 2)]);
}
