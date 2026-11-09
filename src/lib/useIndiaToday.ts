"use client";

import { useCallback, useSyncExternalStore } from "react";
import { dailyBudgetToday } from "@/lib/dailyBudget";

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const listeners = new Set<() => void>();

let midnightTimer: number | null = null;

function getSnapshot() {
  return dailyBudgetToday();
}

function notify() {
  listeners.forEach((listener) => listener());
}

function clearMidnightTimer() {
  if (midnightTimer !== null) {
    window.clearTimeout(midnightTimer);
    midnightTimer = null;
  }
}

function scheduleMidnight() {
  clearMidnightTimer();
  if (document.visibilityState !== "visible" || listeners.size === 0) return;

  const now = Date.now();
  const nextIndiaMidnight = Math.floor((now + INDIA_OFFSET_MS) / DAY_MS + 1) * DAY_MS - INDIA_OFFSET_MS;
  midnightTimer = window.setTimeout(() => {
    midnightTimer = null;
    notify();
    scheduleMidnight();
  }, Math.max(1, nextIndiaMidnight - now));
}

function handleVisibilityChange() {
  if (document.visibilityState === "visible") {
    notify();
    scheduleMidnight();
  } else {
    clearMidnightTimer();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleMidnight();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearMidnightTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
  };
}

/**
 * The current India calendar date. All mounted consumers share one timer that wakes exactly at
 * midnight and is suspended while the document is hidden.
 */
export function useIndiaToday(initial: string) {
  const getServerSnapshot = useCallback(() => initial, [initial]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
