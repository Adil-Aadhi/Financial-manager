"use client";

import React from "react";
import { Check, Pipette } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme } from "./ThemeProvider";
import { ACCENT_PRESETS, hexToAccent } from "./accent";

/** Accent colour swatches + a custom colour picker. */
export function AccentPicker({ className }: { className?: string }) {
  const { accent, setAccent } = useTheme();
  const isCustom = accent.id === "custom";
  const activePreset = ACCENT_PRESETS.find((p) => p.id === accent.id);
  const currentColor = accent.hex ?? activePreset?.swatch ?? "#10b981";

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
            <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/35 to-transparent" />
            {active && <Check className="pointer-events-none relative h-4 w-4 text-white drop-shadow" strokeWidth={3} />}
          </button>
        );
      })}

      {/* Custom colour */}
      <label
        title="Custom colour"
        className={cn(
          "relative flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full transition-all duration-200",
          "ring-offset-2 ring-offset-[var(--glass-strong)] hover:scale-105",
          isCustom ? "ring-2 ring-fg" : "ring-1 ring-line-strong",
          "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-fg"
        )}
        style={{
          background: isCustom
            ? accent.hex
            : "conic-gradient(from 0deg, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)",
        }}
      >
        <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/30 to-transparent" />
        {isCustom ? (
          <Check className="pointer-events-none relative h-4 w-4 text-white drop-shadow" strokeWidth={3} />
        ) : (
          <Pipette className="pointer-events-none relative h-4 w-4 text-white drop-shadow" strokeWidth={2.5} />
        )}
        <input
          type="color"
          aria-label="Custom colour"
          title="Custom colour"
          value={currentColor}
          onChange={(e) => setAccent(hexToAccent(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:outline-none"
        />
      </label>
    </div>
  );
}
