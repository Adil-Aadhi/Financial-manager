import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/** Icon tile + heading + description used at the top of each multi-step auth screen. */
export function AuthStepHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
}) {
  return (
    <div className="mb-7 space-y-4">
      <span className="glass glass-edge flex h-12 w-12 items-center justify-center rounded-2xl text-accent">
        {icon}
      </span>
      <div className="space-y-1.5">
        <h2 className="text-[26px] font-semibold leading-tight tracking-tight text-fg">{title}</h2>
        <p className="text-sm leading-relaxed text-fg-muted">{description}</p>
      </div>
    </div>
  );
}

/** Compact horizontal progress for multi-step flows (e.g. password reset). */
export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-7 flex items-center gap-2" aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={label}
            className={cn("flex items-center gap-2", i < steps.length - 1 && "flex-1")}
            aria-current={active ? "step" : undefined}
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-300",
                done && "bg-accent text-accent-fg",
                active && "bg-brand text-accent-fg shadow-glow",
                !done && !active && "border border-line-strong text-fg-subtle"
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={cn(
                "hidden text-xs font-medium sm:inline",
                active ? "text-fg" : done ? "text-fg-muted" : "text-fg-subtle"
              )}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <span className="h-px flex-1 overflow-hidden rounded bg-line-strong">
                <span
                  className={cn("block h-full bg-accent transition-all duration-500", done ? "w-full" : "w-0")}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
