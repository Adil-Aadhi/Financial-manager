"use client";

import { useCallback, useState } from "react";
import { useAuthenticatedApp } from "@/components/auth/AuthenticatedAppProvider";
import { AddCategoryButton } from "@/components/categories/AddCategoryButton";
import { OfflineCategoryManager } from "@/components/categories/OfflineCategoryManager";
import { PageHeader } from "@/components/layout/AppShell";

export function CategoriesPageContent() {
  const { id: ownerId } = useAuthenticatedApp();
  const [localSnapshotReady, setLocalSnapshotReady] = useState(false);
  const handleReadyChange = useCallback((ready: boolean) => {
    setLocalSnapshotReady(ready);
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Organization"
        title="Categories"
        description="Keep income and expense categories clear and consistent."
        action={<AddCategoryButton disabled={!localSnapshotReady} />}
      />

      <OfflineCategoryManager
        ownerId={ownerId}
        onReadyChange={handleReadyChange}
      />
    </>
  );
}
