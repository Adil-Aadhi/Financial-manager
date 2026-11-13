import type { Metadata } from "next";
import { DuesView } from "@/components/ledger/DuesView";

export const instant = false;
export const metadata: Metadata = { title: "Manual Dues | AccountTracker" };

export default function LedgerDuesPage() {
  return <DuesView />;
}
