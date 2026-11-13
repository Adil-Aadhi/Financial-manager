import type { Metadata } from "next";
import { OverviewView } from "@/components/ledger/OverviewView";

export const instant = false;
export const metadata: Metadata = {
  title: "Personal Ledger | AccountTracker",
  description: "Track money other people owe you.",
};

export default function LedgerOverviewPage() {
  return <OverviewView />;
}
