"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Alert } from "@/components/ui/Alert";
import { SectionRefreshIndicator } from "@/components/ui/SectionRefreshIndicator";
import { CategoryManager } from "@/components/categories/CategoryManager";
import type { CategoryRecord } from "@/lib/categories";
import { isCategoryType } from "@/lib/categories";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import { useLocalContentMark } from "@/lib/perf";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";

export function OfflineCategoryManager({
  ownerId,
  onReadyChange,
}: {
  ownerId: string;
  onReadyChange?: (ready: boolean) => void;
}) {
  const isOnline = useOnlineStatus();
  useOfflineRefresh(ownerId, "local-first", "offline categories");

  const localCategories = useLiveQuery(async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.totalsMatch) return null;

    const rows = await offlineDb.categories.where("ownerId").equals(ownerId).toArray();
    return rows
      .flatMap<CategoryRecord>((category) =>
        isCategoryType(category.type)
          ? [
              {
                id: category.id,
                name: category.name,
                type: category.type,
                icon: category.icon,
                user_id: category.user_id,
                is_default: category.is_default,
              },
            ]
          : []
      )
      .sort(
        (left, right) =>
          Number(right.is_default) - Number(left.is_default) ||
          left.name.localeCompare(right.name)
      );
  }, [ownerId]);
  const ready = localCategories != null;
  useLocalContentMark(ready); // TEMPORARY perf (Step 3 Phase 0)

  useEffect(() => {
    onReadyChange?.(ready);
  }, [onReadyChange, ready]);

  if (!ready) {
    return (
      <div className="relative space-y-4">
        <SectionRefreshIndicator scope="categories" className="absolute right-0 -top-5" />
        <Alert
          variant="info"
          title={isOnline ? "Preparing categories" : "Categories are not saved on this device yet"}
        >
          {isOnline
            ? "Your saved categories will appear after the first device snapshot finishes."
            : "Connect to the internet once to download your categories for offline use."}
        </Alert>
        <div className="glass glass-edge animate-pulse rounded-2xl p-4 sm:p-5" aria-hidden="true">
          <div className="grid grid-cols-2 gap-2 border-b border-line pb-4">
            <div className="h-11 rounded-xl bg-glass-hover" />
            <div className="h-11 rounded-xl bg-glass-hover" />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-[76px] rounded-2xl bg-glass-hover" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const defaultsReady = localCategories.filter((category) => category.is_default).length >= 17;

  return (
    <div className="relative space-y-4">
      <SectionRefreshIndicator scope="categories" className="absolute right-0 -top-5" />
      {!isOnline && (
        <Alert variant="info" title="You are offline">
          Category changes are saved on this device and sync later.
        </Alert>
      )}
      {!defaultsReady && (
        <Alert variant="warning" title="Database update required">
          Run the categories migration in Supabase to enable the protected default categories.
        </Alert>
      )}
      <CategoryManager
        categories={localCategories}
        mutationsEnabled
      />
    </div>
  );
}
