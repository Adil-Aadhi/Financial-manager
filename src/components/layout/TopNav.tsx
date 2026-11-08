"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DESKTOP_NAV_ITEMS,
  DESKTOP_MORE_NAV_ITEMS,
  isActivePath,
} from "./nav-items";

const emptySubscribe = () => () => {};

/** Desktop navbar links (lg+). Mobile uses BottomNav. */
export function TopNav() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setIsOpen(false);
  }

  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const place = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) {
      setPos({
        top: r.bottom + 8,
        right: Math.max(window.innerWidth - r.right, 12),
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (isOpen) place();
  }, [isOpen, place]);

  useEffect(() => {
    if (!isOpen) return;

    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!document.contains(t)) return;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) {
        setIsOpen(false);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    const onResize = () => {
      if (window.innerWidth < 1024) {
        setIsOpen(false);
      } else {
        place();
      }
    };

    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", place, { passive: true });

    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", place);
    };
  }, [isOpen, place]);

  const isMoreActive =
    DESKTOP_MORE_NAV_ITEMS.some(({ href }) => isActivePath(pathname, href)) ||
    isOpen;

  return (
    <>
      <nav
        aria-label="Main"
        className="hidden items-center gap-1 rounded-xl border border-line bg-glass-hover p-1 lg:flex"
      >
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
              <Icon
                className={cn(
                  "h-4 w-4",
                  active ? "text-accent" : "text-fg-subtle"
                )}
                strokeWidth={2.1}
              />
              {label}
            </Link>
          );
        })}

        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label="More navigation options"
          className={cn(
            "flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-all duration-200",
            isMoreActive
              ? "bg-glass-strong text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08),inset_0_0_0_1px_var(--line)]"
              : "text-fg-muted hover:text-fg"
          )}
        >
          <Ellipsis
            className={cn(
              "h-4 w-4",
              isMoreActive ? "text-accent" : "text-fg-subtle"
            )}
            strokeWidth={2.1}
          />
          <span>More</span>
        </button>
      </nav>

      {isMounted &&
        isOpen &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="More options"
            style={{ top: pos.top, right: pos.right }}
            className="glass-strong glass-edge fixed z-50 hidden w-56 animate-rise rounded-2xl p-2 text-fg shadow-glass lg:block"
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              More
            </div>
            <div className="space-y-1">
              {DESKTOP_MORE_NAV_ITEMS.map(({ label, href, icon: ItemIcon }) => {
                const active = isActivePath(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setIsOpen(false)}
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
          </div>,
          document.body
        )}
    </>
  );
}
