"use client";

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
  serverCategories,
}: {
  ownerId: string;
  serverCategories: CategoryRecord[];
}) {
  const isOnline = useOnlineStatus();
  const serverVersion = serverCategories
    .map((category) => `${category.id}:${category.name}:${category.type}:${category.icon}`)
    .join("|");

  useOfflineRefresh(ownerId, serverVersion, "offline categories");

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
  useLocalContentMark(localCategories != null); // TEMPORARY perf (Step 3 Phase 0)

  return (
    <div className="relative space-y-4">
      <SectionRefreshIndicator scope="categories" className="absolute right-0 -top-5" />
      {!isOnline && (
        <Alert variant="info" title="You are offline">
          Category changes are saved on this device and sync later.
        </Alert>
      )}
      <CategoryManager
        categories={localCategories ?? serverCategories}
        mutationsEnabled
      />
    </div>
  );
}
