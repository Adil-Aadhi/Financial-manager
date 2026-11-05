"use client";

import { Plus } from "lucide-react";
import { useFAB } from "@/components/layout/FABContext";
import { Button } from "@/components/ui/Button";

export function AddAccountButton() {
  const { openAddAccount } = useFAB();
  return (
    <Button variant="ghost" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={openAddAccount}>
      Add Account
    </Button>
  );
}
