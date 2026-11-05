import {
  BarChart3,
  Home,
  ReceiptText,
  Settings,
  Trash2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/** Primary desktop navbar destinations (lg+). */
export const DESKTOP_NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Transactions", href: "/transactions", icon: ReceiptText },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Trash", href: "/trash", icon: Trash2 },
  { label: "Settings", href: "/settings", icon: Settings },
];

/** Left items for mobile bottom nav (before the raised FAB). */
export const MOBILE_LEFT_NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Transactions", href: "/transactions", icon: ReceiptText },
];

/** Right items for mobile bottom nav (after the raised FAB, before More). */
export const MOBILE_RIGHT_NAV_ITEMS: NavItem[] = [
  { label: "Reports", href: "/reports", icon: BarChart3 },
];

/** Items inside the mobile "More" menu. */
export const MORE_NAV_ITEMS: NavItem[] = [
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Trash", href: "/trash", icon: Trash2 },
];

/** Backward-compatible export for any consumers of NAV_ITEMS. */
export const NAV_ITEMS: NavItem[] = DESKTOP_NAV_ITEMS;

/** Target of the global "Add" action. Points at the transactions page until the add flow exists. */
export const ADD_TRANSACTION_HREF = "/transactions";

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
