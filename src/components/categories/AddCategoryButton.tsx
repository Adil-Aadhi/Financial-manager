"use client";

import { Plus } from "lucide-react";
import { useFAB } from "@/components/layout/FABContext";
import { Button } from "@/components/ui/Button";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";

export function AddCategoryButton() {
  const { openAddCategory } = useFAB();
  const isOnline = useOnlineStatus();

  return (
    <Button
      size="sm"
      leftIcon={<Plus className="h-4 w-4" />}
      onClick={openAddCategory}
      title={isOnline ? undefined : "Saved on this device and synced later"}
    >
      Add Category
    </Button>
  );
}
