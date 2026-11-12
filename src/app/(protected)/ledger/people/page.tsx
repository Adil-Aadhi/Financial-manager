import type { Metadata } from "next";
import { PeopleView } from "@/components/ledger/PeopleView";

export const instant = false;
export const metadata: Metadata = { title: "Ledger People | AccountTracker" };

export default function LedgerPeoplePage() {
  return <PeopleView />;
}
