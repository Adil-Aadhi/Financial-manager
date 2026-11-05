"use client";

import React, { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarRange, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { REPORT_PRESETS, type ReportPreset } from "@/lib/reports";

/**
 * One filter row above every report section. Changing it navigates with new
 * search params; the previous report stays visible (dimmed) until the new one
 * arrives, so there is no skeleton flash.
 */
export function ReportFilters({
  preset,
  start,
  end,
  label,
  currency,
  currencies,
  children,
}: {
  preset: ReportPreset;
  start: string;
  end: string;
  label: string;
  currency: string;
  currencies: string[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [showCustom, setShowCustom] = useState(preset === "custom");
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const [customError, setCustomError] = useState<string | null>(null);
  const [prevPreset, setPrevPreset] = useState(preset);

  // Keep the custom panel in sync with the URL (back/forward navigation).
  if (prevPreset !== preset) {
    setPrevPreset(preset);
    setShowCustom(preset === "custom");
  }

  const navigate = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    startTransition(() => {
      router.push(`${pathname}?${search.toString()}`, { scroll: false });
    });
  };

  const base = { currency: currencies.length > 1 ? currency : undefined };

  const choosePreset = (next: ReportPreset) => {
    if (next === "custom") {
      // Start from the period currently on screen.
      setFrom(start);
      setTo(end);
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    setCustomError(null);
    navigate({ ...base, range: next === "this-month" ? undefined : next });
  };

  const applyCustom = (event: React.FormEvent) => {
    event.preventDefault();
    if (!from || !to) {
      setCustomError("Choose a start and end date.");
      return;
    }
    if (from > to) {
      setCustomError("Start date must be before the end date.");
      return;
    }
    setCustomError(null);
    navigate({ ...base, range: "custom", from, to });
  };

  const activePreset = showCustom ? "custom" : preset;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="space-y-3">
        <div
          role="tablist"
          aria-label="Report period"
          className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          {REPORT_PRESETS.map((option) => {
            const active = activePreset === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => choosePreset(option.id)}
                className={cn(
                  "flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-all duration-200",
                  active
                    ? "border-transparent bg-brand text-accent-fg shadow-glow"
                    : "border-line bg-glass-input text-fg-muted hover:text-fg"
                )}
              >
                {option.id === "custom" && <CalendarRange className="h-3.5 w-3.5" />}
                {option.label}
              </button>
            );
          })}
        </div>

        {showCustom && (
          <form
            onSubmit={applyCustom}
            noValidate
            className="glass animate-fade grid grid-cols-2 items-end gap-2 rounded-2xl p-3 sm:grid-cols-[1fr_1fr_auto] sm:gap-3"
          >
            <Input
              label="From"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => {
                setFrom(event.target.value);
                setCustomError(null);
              }}
              className="h-10 text-base sm:text-sm"
            />
            <Input
              label="To"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => {
                setTo(event.target.value);
                setCustomError(null);
              }}
              className="h-10 text-base sm:text-sm"
            />
            <Button type="submit" className="col-span-2 h-10 sm:col-span-1" isLoading={isPending}>
              Apply
            </Button>
            {customError && (
              <p className="col-span-full animate-fade text-xs font-medium text-danger">{customError}</p>
            )}
          </form>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
            <span className="truncate">{label}</span>
            {isPending && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-fg-subtle" aria-label="Updating" />}
          </p>
          {currencies.length > 1 && (
            <div role="radiogroup" aria-label="Currency" className="glass-track flex shrink-0 gap-0.5 rounded-full p-0.5">
              {currencies.map((code) => (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={code === currency}
                  onClick={() =>
                    navigate({
                      currency: code,
                      range: preset === "this-month" ? undefined : preset,
                      from: preset === "custom" ? start : undefined,
                      to: preset === "custom" ? end : undefined,
                    })
                  }
                  className={cn(
                    "h-7 cursor-pointer rounded-full px-2.5 font-mono text-[11px] font-semibold transition-colors",
                    code === currency ? "glass text-fg" : "text-fg-subtle hover:text-fg"
                  )}
                >
                  {code}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        aria-busy={isPending || undefined}
        className={cn("transition-opacity duration-200", isPending && "pointer-events-none opacity-50")}
      >
        {children}
      </div>
    </div>
  );
}
