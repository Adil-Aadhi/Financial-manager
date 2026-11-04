import { BarChart3, Home, ReceiptText, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/** Primary destinations. Order matters: bottom nav splits these 2 + [Add] + 2. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Transactions", href: "/transactions", icon: ReceiptText },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Settings", href: "/settings", icon: Settings },
];

/** Target of the global "Add" action. Points at the transactions page until the add flow exists. */
export const ADD_TRANSACTION_HREF = "/transactions";

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
