"use client";

import React from "react";
import { ACCOUNT_GROUP_LABELS, ACCOUNT_GROUPS, type AccountGroup } from "@/lib/accounts";
import { cn } from "@/lib/cn";

/** Primary/General choice used by the Add Account and Edit Account forms. */
export function AccountGroupSelector({
  value,
  onChange,
  disabled,
}: {
  value: AccountGroup;
  onChange: (group: AccountGroup) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-[13px] font-medium text-fg-muted">Group</legend>
      <div
        role="radiogroup"
        aria-label="Account group"
        className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-glass-input p-1"
      >
        {ACCOUNT_GROUPS.map((group) => {
          const active = value === group;
          return (
            <button
              key={group}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(group)}
              disabled={disabled}
              className={cn(
                "h-10 cursor-pointer rounded-lg text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                active
                  ? "bg-accent/12 text-accent"
                  : "text-fg-muted hover:bg-glass-hover hover:text-fg"
              )}
            >
              {ACCOUNT_GROUP_LABELS[group]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
