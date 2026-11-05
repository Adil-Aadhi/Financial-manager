"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * TEMPORARY navigation timing (Step 3, Phase 0). Remove with PerfOverlay once Step 3 is done.
 *
 * Enabled only when localStorage.ftPerf === "1". When disabled every export is a cheap no-op:
 * no listeners, no observers, no storage writes.
 *
 * Per navigation it records, relative to the tap (the click event's timestamp):
 * - `routeMs`: the new route is on screen. Pages block on the server today, so this is also
 *   when server data arrives.
 * - `localMs`: the page's IndexedDB (useLiveQuery) data is on screen.
 * - `rscMs`: duration of the RSC request for that route, if one was made after the tap.
 */

export interface PerfEntry {
  id: number;
  kind: "nav" | "load";
  path: string;
  at: number; // epoch ms, for the copied log
  routeMs?: number;
  localMs?: number;
  rscMs?: number;
}

const LOG_KEY = "ftPerfLog";
const MAX_ENTRIES = 60;

let enabled: boolean | null = null;
let entries: PerfEntry[] = [];
let active: (PerfEntry & { start: number; from: string }) | null = null;
let loadEntry: PerfEntry | null = null;
let idCounter = 0;
/** Unique across page loads, so entries restored from localStorage never collide. */
const newId = () => Date.now() * 1000 + (idCounter++ % 1000);
const subscribers = new Set<() => void>();

export function isPerfEnabled() {
  if (enabled === null) {
    try {
      enabled = typeof window !== "undefined" && window.localStorage.getItem("ftPerf") === "1";
    } catch {
      enabled = false;
    }
    if (enabled) loadPerfLog();
  }
  return enabled;
}

function persist() {
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Private mode or quota: keep the in-memory log only.
  }
}

function emit() {
  subscribers.forEach((fn) => fn());
}

function save(entry: PerfEntry) {
  const index = entries.findIndex((item) => item.id === entry.id);
  if (index === -1) entries = [...entries, entry].slice(-MAX_ENTRIES);
  else entries = entries.map((item) => (item.id === entry.id ? { ...entry } : item));
  persist();
  emit();
}

/** Call after the next frame so the time includes React's commit and the browser's paint. */
function afterPaint(fn: () => void) {
  // Hidden or throttled pages (Safari app switcher, background tabs) may never run rAF
  // callbacks, so fall back to a timeout; the timing is then marked as approximate.
  let done = false;
  const run = (approximate: boolean) => {
    if (done) return;
    done = true;
    if (approximate) approximateCount += 1;
    fn();
  };
  if (document.visibilityState !== "visible") {
    setTimeout(() => run(true), 0);
    return;
  }
  requestAnimationFrame(() => setTimeout(() => run(false), 0));
  setTimeout(() => run(true), 1000);
}

/** How many timings fell back to the timeout instead of a painted frame. */
let approximateCount = 0;
export function getApproximateCount() {
  return approximateCount;
}

function loadPerfLog() {
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    entries = raw ? (JSON.parse(raw) as PerfEntry[]) : [];
  } catch {
    entries = [];
  }
}

export function getPerfEntries() {
  return entries;
}

export function subscribePerf(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function clearPerfLog() {
  entries = [];
  persist();
  emit();
}

/** A same-origin link was tapped. `timeStamp` is the click event's high-resolution time. */
export function startNavigation(path: string, timeStamp: number) {
  if (!isPerfEnabled()) return;
  active = {
    id: newId(),
    kind: "nav",
    path,
    at: Date.now(),
    start: timeStamp,
    from: window.location.pathname,
  };
  save(stripStart(active));
}

/** The router committed a new pathname (the tapped one, or wherever a redirect landed). */
export function markRouteShown(path: string) {
  if (!isPerfEnabled() || !active || active.routeMs !== undefined || path === active.from) return;
  const current = active;
  current.path = path;
  afterPaint(() => {
    current.routeMs = Math.round(performance.now() - current.start);
    save(stripStart(current));
  });
}

/** Records how long the navigation's RSC request took (from resource timing). */
export function markRscDuration(path: string, startTime: number, duration: number) {
  if (!active || active.path !== path || startTime < active.start) return;
  active.rscMs = Math.round(duration);
  save(stripStart(active));
}

/** The current page is showing IndexedDB data. */
export function markLocalContent(path: string) {
  if (!isPerfEnabled()) return;
  if (active && active.path === path) {
    if (active.localMs !== undefined) return;
    const current = active;
    current.localMs = -1; // reserve: only the first local render counts
    afterPaint(() => {
      current.localMs = Math.round(performance.now() - current.start);
      save(stripStart(current));
    });
    return;
  }
  // Hard load / PWA launch: measure from the start of the document navigation.
  if (!active && !loadEntry) {
    const entry: PerfEntry = { id: newId(), kind: "load", path, at: Date.now() };
    loadEntry = entry;
    afterPaint(() => {
      entry.localMs = Math.round(performance.now());
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (nav) entry.routeMs = Math.round(nav.responseEnd);
      save(entry);
    });
  }
}

/** TEMPORARY: marks when a page first shows IndexedDB data. No-op unless ftPerf is on. */
export function useLocalContentMark(ready: boolean) {
  const pathname = usePathname();
  useEffect(() => {
    if (ready) markLocalContent(pathname);
  }, [pathname, ready]);
}

function stripStart(entry: PerfEntry & { start: number; from: string }): PerfEntry {
  const { id, kind, path, at, routeMs, localMs, rscMs } = entry;
  return { id, kind, path, at, routeMs, localMs: localMs === -1 ? undefined : localMs, rscMs };
}
