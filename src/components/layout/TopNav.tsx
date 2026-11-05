"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { DESKTOP_NAV_ITEMS, isActivePath } from "./nav-items";

/** Desktop navbar links (lg+). Mobile uses BottomNav. */
export function TopNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="hidden items-center gap-1 rounded-xl border border-line bg-glass-hover p-1 lg:flex">
      {DESKTOP_NAV_ITEMS.map(({ label, href, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-all duration-200",
              active
                ? "bg-glass-strong text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08),inset_0_0_0_1px_var(--line)]"
                : "text-fg-muted hover:text-fg"
            )}
          >
            <Icon className={cn("h-4 w-4", active ? "text-accent" : "text-fg-subtle")} strokeWidth={2.1} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
