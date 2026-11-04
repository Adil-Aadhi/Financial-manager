"use client";

import React, { useRef } from "react";
import { Check, Pipette } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme } from "./ThemeProvider";
import { ACCENT_PRESETS, hexToAccent } from "./accent";

/** Accent colour swatches + a custom colour picker. */
export function AccentPicker({ className }: { className?: string }) {
  const { accent, setAccent } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const isCustom = accent.id === "custom";

  return (
    <div className={cn("flex flex-wrap items-center gap-2.5", className)} role="radiogroup" aria-label="Accent colour">
      {ACCENT_PRESETS.map((p) => {
        const active = accent.id === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={p.name}
            title={p.name}
            onClick={() => setAccent({ id: p.id, h: p.h, c: p.c })}
            className={cn(
              "relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-all duration-200",
              "ring-offset-2 ring-offset-[var(--glass-strong)] hover:scale-105",
              active ? "ring-2 ring-fg" : "ring-1 ring-line-strong"
            )}
            style={{ background: p.swatch }}
          >
            <span className="absolute inset-0 rounded-full bg-gradient-to-b from-white/35 to-transparent" />
            {active && <Check className="relative h-4 w-4 text-white drop-shadow" strokeWidth={3} />}
          </button>
        );
      })}

      {/* Custom colour */}
      <button
        type="button"
        role="radio"
        aria-checked={isCustom}
        aria-label="Custom colour"
        title="Custom colour"
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full transition-all duration-200",
          "ring-offset-2 ring-offset-[var(--glass-strong)] hover:scale-105",
          isCustom ? "ring-2 ring-fg" : "ring-1 ring-line-strong"
        )}
        style={{
          background: isCustom
            ? accent.hex
            : "conic-gradient(from 0deg, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)",
        }}
      >
        <span className="absolute inset-0 rounded-full bg-gradient-to-b from-white/30 to-transparent" />
        {isCustom ? (
          <Check className="relative h-4 w-4 text-white drop-shadow" strokeWidth={3} />
        ) : (
          <Pipette className="relative h-4 w-4 text-white drop-shadow" strokeWidth={2.5} />
        )}
        <input
          ref={inputRef}
          type="color"
          tabIndex={-1}
          aria-hidden="true"
          value={accent.hex ?? "#10b981"}
          onChange={(e) => setAccent(hexToAccent(e.target.value))}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      </button>
    </div>
  );
}
