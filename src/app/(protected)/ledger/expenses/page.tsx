import type { Metadata } from "next";
import { ExpensesView } from "@/components/ledger/ExpensesView";

export const instant = false;
export const metadata: Metadata = { title: "Shared Expenses | AccountTracker" };

export default function LedgerExpensesPage() {
  return <ExpensesView />;
}
