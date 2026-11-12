"use client";

import { useSyncExternalStore } from "react";

export type RefreshScope =
  | "transactions"
  | "accounts"
  | "dashboard"
  | "categories"
  | "monthly-budget"
  | "daily-budget"
  | "bills"
  | "subscriptions"
  | "installments"
  | "ledger";

const active = new Map<number, ReadonlySet<RefreshScope>>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

export function beginRefreshFeedback(generation: number, scopes: readonly RefreshScope[]) {
  if (!scopes.length) return;
  active.set(generation, new Set(scopes));
  notify();
}

export function finishRefreshFeedback(generation: number) {
  let changed = false;
  for (const activeGeneration of active.keys()) {
    if (activeGeneration <= generation) {
      active.delete(activeGeneration);
      changed = true;
    }
  }
  if (changed) notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return version;
}

function getServerSnapshot() {
  return 0;
}

export function useRefreshFeedback(scopes: RefreshScope | readonly RefreshScope[]) {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const requested = new Set(Array.isArray(scopes) ? scopes : [scopes]);
  for (const activeScopes of active.values()) {
    for (const scope of requested) {
      if (activeScopes.has(scope)) return true;
    }
  }
  return false;
}
