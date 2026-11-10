"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/auth/BrandLogo";

const MINIMUM_VISIBLE_MS = 420;
const EXIT_DURATION_MS = 420;
const STARTUP_FAILSAFE_MS = 10_000;

type LaunchPhase = "visible" | "leaving" | "hidden";

function waitForWindowLoad() {
  if (document.readyState === "complete") return Promise.resolve();

  return new Promise<void>((resolve) => {
    window.addEventListener("load", () => resolve(), { once: true });
  });
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    if (document.visibilityState !== "visible") {
      window.setTimeout(finish, 0);
      return;
    }

    requestAnimationFrame(() => requestAnimationFrame(finish));
    // Safari can pause animation frames while an app is being backgrounded.
    window.setTimeout(finish, 1_000);
  });
}

/**
 * A one-document launch layer. The root layout keeps this component mounted during
 * App Router navigation, so the animation cannot replay until the PWA is launched or
 * the document is deliberately reloaded again.
 */
export function AppLaunchScreen() {
  const [phase, setPhase] = useState<LaunchPhase>("visible");

  useEffect(() => {
    const mountedAt = performance.now();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let minimumTimer: number | undefined;
    let cancelled = false;
    let dismissalStarted = false;

    const dismiss = () => {
      if (cancelled || dismissalStarted) return;
      dismissalStarted = true;
      const minimum = reducedMotion ? 0 : MINIMUM_VISIBLE_MS;
      const remaining = Math.max(0, minimum - (performance.now() - mountedAt));
      minimumTimer = window.setTimeout(() => {
        if (!cancelled) setPhase("leaving");
      }, remaining);
    };

    const markInitialContentReady = async () => {
      try {
        // Hydration has committed before this effect runs. Waiting for the document load
        // and the next painted frame makes sure the real route is ready beneath the layer.
        await waitForWindowLoad();
        await waitForPaint();
      } finally {
        dismiss();
      }
    };

    void markInitialContentReady();
    // This is only an error escape hatch, never the primary readiness mechanism.
    const failSafeTimer = window.setTimeout(dismiss, STARTUP_FAILSAFE_MS);

    return () => {
      cancelled = true;
      if (minimumTimer !== undefined) window.clearTimeout(minimumTimer);
      window.clearTimeout(failSafeTimer);
    };
  }, []);

  useEffect(() => {
    if (phase !== "leaving") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(
      () => setPhase("hidden"),
      reducedMotion ? 0 : EXIT_DURATION_MS
    );
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "hidden") return null;

  return (
    <div
      className="app-launch-screen"
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-label="Account Tracker is loading"
    >
      <div className="app-launch-aurora" aria-hidden="true" />
      <div className="app-launch-brand">
        <div className="app-launch-mark" aria-hidden="true">
          <BrandMark size="xl" />
        </div>
        <div className="app-launch-copy">
          <p className="app-launch-name">
            Account <span>Tracker</span>
          </p>
          <p className="app-launch-tagline">YOUR MONEY. IN CONTROL.</p>
        </div>
        <div className="app-launch-progress" aria-hidden="true">
          <span />
        </div>
        <span className="sr-only">Preparing your finances…</span>
      </div>
    </div>
  );
}
