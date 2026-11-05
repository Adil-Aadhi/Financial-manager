"use client";

import { Plus } from "lucide-react";
import { useFAB } from "@/components/layout/FABContext";
import { Button } from "@/components/ui/Button";

export function AddCategoryButton() {
  const { openAddCategory } = useFAB();

  return (
    <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={openAddCategory}>
      Add Category
    </Button>
  );
}
