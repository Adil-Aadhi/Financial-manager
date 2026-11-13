"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarSync, HandCoins, LayoutDashboard, ReceiptText, Users, History } from "lucide-react";
import { cn } from "@/lib/cn";
import { warmLedgerRoutes } from "@/lib/offline/warmRoutes";
import { useLedger } from "./LedgerProvider";

const ITEMS = [
  { label: "Overview", href: "/ledger", icon: LayoutDashboard, exact: true },
  { label: "Recurring Dues", href: "/ledger/recurring", icon: CalendarSync },
  { label: "Shared Expenses", href: "/ledger/expenses", icon: ReceiptText },
  { label: "Manual Dues", href: "/ledger/dues", icon: HandCoins },
  { label: "People", href: "/ledger/people", icon: Users },
  { label: "Payment History", href: "/ledger/payments", icon: History },
] as const;

/** Sub-navigation for the Personal Ledger: a scrollable row of pills that fits a phone. */
export function LedgerNav() {
  const pathname = usePathname();
  const { data } = useLedger();
  // Hovering, focusing or touching a section is the signal that it is about to be opened: store that
  // page for offline use then (once, and only if it isn't stored already), not for all of them up front.
  const warmOnIntent = (href: string) => {
    if (data.source === "local" && data.available) void warmLedgerRoutes([href]);
  };
  return (
    <nav aria-label="Personal Ledger sections" className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mb-6 sm:px-0">
      {ITEMS.map(({ label, href, icon: Icon, ...rest }) => {
        const active = "exact" in rest ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            onPointerEnter={() => warmOnIntent(href)}
            onFocus={() => warmOnIntent(href)}
            onTouchStart={() => warmOnIntent(href)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors",
              active ? "border-accent/30 bg-accent/12 text-accent" : "border-line bg-glass-hover text-fg-muted hover:text-fg"
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
