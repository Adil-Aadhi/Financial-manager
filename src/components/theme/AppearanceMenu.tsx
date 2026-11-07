"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Palette } from "lucide-react";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "./ThemeToggle";
import { AccentPicker } from "./AccentPicker";

/**
 * Navbar button that opens a glass popover with mode (light/dark/system) + accent colour.
 *
 * The popover is portalled to <body>: the navbar has its own backdrop-filter, which would
 * otherwise become the popover's backdrop root and stop it blurring the page behind.
 */
export function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 10, right: Math.max(window.innerWidth - r.right, 12) });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!document.contains(t)) return;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Appearance"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border transition-colors",
          open
            ? "border-accent/40 bg-accent/12 text-accent"
            : "border-line bg-glass-hover text-fg-muted hover:text-fg"
        )}
      >
        <Palette className="h-[18px] w-[18px]" />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Appearance"
            style={{ top: pos.top, right: pos.right }}
            className="glass-strong glass-edge fixed z-[60] w-[272px] animate-rise rounded-2xl p-4 text-fg"
          >
            <p className="text-xs font-medium text-fg-subtle">Mode</p>
            <ThemeToggle className="mt-2" />
            <p className="mt-4 text-xs font-medium text-fg-subtle">Colour</p>
            <AccentPicker className="mt-2" />
          </div>,
          document.body
        )}
    </>
  );
}
