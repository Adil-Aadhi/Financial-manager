import type { Metadata } from "next";
import { RecurringView } from "@/components/ledger/RecurringView";

export const instant = false;
export const metadata: Metadata = { title: "Recurring Dues | AccountTracker" };

export default function LedgerRecurringPage() {
  return <RecurringView />;
}
