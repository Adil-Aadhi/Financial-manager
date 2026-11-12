import type { Metadata } from "next";
import { PaymentsView } from "@/components/ledger/PaymentsView";

export const instant = false;
export const metadata: Metadata = { title: "Payment History | AccountTracker" };

export default function LedgerPaymentsPage() {
  return <PaymentsView />;
}
