"use client";

import { useSyncExternalStore } from "react";

/**
 * The user whose page is on screen. Every protected page renders an offline component with
 * the server-verified ownerId (live, or from the service worker's cached copy of that page),
 * and that component registers it here. Local mutations and the pending-changes notice use it,
 * so they never need a network call to know whose data they are touching.
 *
 * In memory only: cleared on sign-out and on every full page load.
 */
let activeOwnerId: string | null = null;
const listeners = new Set<() => void>();

export function setActiveOwnerId(ownerId: string | null) {
  if (activeOwnerId === ownerId) return;
  activeOwnerId = ownerId;
  listeners.forEach((listener) => listener());
}

export function getActiveOwnerId() {
  return activeOwnerId;
}

export function subscribeActiveOwner(listener: () => void) {
  return subscribe(listener);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActiveOwnerId() {
  return useSyncExternalStore(subscribe, getActiveOwnerId, () => null);
}
