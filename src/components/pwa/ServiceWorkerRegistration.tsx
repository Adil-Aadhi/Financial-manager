"use client";

import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function ServiceWorkerRegistration() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;

    let reloading = false;
    let registration: ServiceWorkerRegistration | null = null;

    const showWaitingWorker = (worker: ServiceWorker | null) => {
      if (worker && navigator.serviceWorker.controller) setWaitingWorker(worker);
    };

    const register = async () => {
      registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      showWaitingWorker(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const installing = registration?.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed") showWaitingWorker(installing);
        });
      });
    };

    const checkForUpdate = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };
    const reloadOnControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    void register().catch((error: unknown) => {
      console.warn(
        "Service worker registration failed:",
        error instanceof Error ? error.message : error
      );
    });
    document.addEventListener("visibilitychange", checkForUpdate);
    navigator.serviceWorker.addEventListener("controllerchange", reloadOnControllerChange);

    return () => {
      document.removeEventListener("visibilitychange", checkForUpdate);
      navigator.serviceWorker.removeEventListener("controllerchange", reloadOnControllerChange);
    };
  }, []);

  if (!waitingWorker) return null;

  return (
    <aside
      role="status"
      className="glass-strong glass-edge fixed inset-x-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl p-3 sm:bottom-6"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="min-w-0 flex-1 text-sm font-medium text-fg">An app update is ready.</p>
      <Button
        size="sm"
        onClick={() => waitingWorker.postMessage({ type: "SKIP_WAITING" })}
      >
        Update
      </Button>
    </aside>
  );
}

