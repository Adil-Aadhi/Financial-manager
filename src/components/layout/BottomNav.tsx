"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { NAV_ITEMS, isActivePath } from "./nav-items";
import { useFAB } from "./FABContext";

/** iPhone-style tab bar: 2 tabs · raised Add · 2 tabs. Sits above the home indicator. */
export function BottomNav() {
  const pathname = usePathname();
  const { triggerAction, fabTooltip } = useFAB();
  const left = NAV_ITEMS.slice(0, 2);
  const right = NAV_ITEMS.slice(2);

  const renderTab = ({ label, href, icon: Icon }: (typeof NAV_ITEMS)[number]) => {
    const active = isActivePath(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors",
          active ? "text-accent" : "text-fg-subtle active:text-fg"
        )}
      >
        <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.3 : 1.9} />
        {label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <div className="glass-strong glass-edge mx-auto flex max-w-md items-stretch rounded-[26px] px-1">
        {left.map(renderTab)}

        <div className="flex flex-1 items-start justify-center">
          <button
            type="button"
            onClick={triggerAction}
            aria-label={fabTooltip}
            title={fabTooltip}
            className="relative -mt-5 flex h-14 w-14 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-brand text-accent-fg shadow-glow ring-4 ring-canvas transition-transform active:scale-95"
          >
            <span className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent" />
            <Plus className="relative h-6 w-6" strokeWidth={2.6} />
          </button>
        </div>

        {right.map(renderTab)}
      </div>
    </nav>
  );
}
