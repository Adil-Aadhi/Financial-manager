"use client";

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  MOBILE_LEFT_NAV_ITEMS,
  MOBILE_RIGHT_NAV_ITEMS,
  MORE_NAV_ITEMS,
  isActivePath,
} from "./nav-items";
import { useFAB } from "./FABContext";

const emptySubscribe = () => () => {};

/** iPhone-style tab bar: 2 tabs · raised Add · 1 tab + More. Sits above the home indicator. */
export function BottomNav() {
  const pathname = usePathname();
  const { triggerAction, fabTooltip } = useFAB();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);

  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setIsMoreOpen(false);
  }

  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  // Close the More menu on Escape key press
  useEffect(() => {
    if (!isMoreOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMoreOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMoreOpen]);

  const isMoreActive =
    MORE_NAV_ITEMS.some(({ href }) => isActivePath(pathname, href)) || isMoreOpen;

  const renderTab = ({
    label,
    href,
    icon: Icon,
  }: (typeof MOBILE_LEFT_NAV_ITEMS)[number]) => {
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
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
      >
        <div className="glass-strong glass-edge mx-auto flex max-w-md items-stretch rounded-[26px] px-1">
          {MOBILE_LEFT_NAV_ITEMS.map(renderTab)}

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

          {MOBILE_RIGHT_NAV_ITEMS.map(renderTab)}

          <button
            type="button"
            onClick={() => setIsMoreOpen((prev) => !prev)}
            aria-expanded={isMoreOpen}
            aria-haspopup="dialog"
            aria-label="More navigation options"
            className={cn(
              "flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors",
              isMoreActive ? "text-accent" : "text-fg-subtle active:text-fg"
            )}
          >
            <Ellipsis
              className="h-[22px] w-[22px]"
              strokeWidth={isMoreActive ? 2.3 : 1.9}
            />
            More
          </button>
        </div>
      </nav>

      {/* Popover More Menu portalled to body to prevent stacking context or blur issues */}
      {isMounted &&
        isMoreOpen &&
        createPortal(
          <div className="lg:hidden">
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-50 bg-canvas/60 backdrop-blur-xs transition-opacity duration-150"
              onClick={() => setIsMoreOpen(false)}
              aria-hidden="true"
            />

            {/* Menu Popover */}
            <div
              role="dialog"
              aria-label="More options"
              className="glass-strong glass-edge fixed bottom-[calc(4.75rem+max(0.75rem,env(safe-area-inset-bottom)))] right-3 z-50 w-56 max-w-[calc(100vw-1.5rem)] animate-rise rounded-2xl p-2 text-fg shadow-glass"
            >
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                More
              </div>
              <div className="space-y-1">
                {MORE_NAV_ITEMS.map(({ label, href, icon: ItemIcon }) => {
                  const active = isActivePath(pathname, href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setIsMoreOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                        active
                          ? "border border-accent/25 bg-accent/12 text-accent"
                          : "text-fg-muted hover:bg-glass-hover hover:text-fg active:bg-glass-hover"
                      )}
                    >
                      <ItemIcon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          active ? "text-accent" : "text-fg-subtle"
                        )}
                        strokeWidth={active ? 2.3 : 2}
                      />
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
