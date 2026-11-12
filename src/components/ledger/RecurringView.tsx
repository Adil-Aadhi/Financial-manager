"use client";

import { useState } from "react";
import { CalendarSync, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionRefreshIndicator } from "@/components/ui/SectionRefreshIndicator";
import { ledgerFrequencyLabel } from "@/lib/ledger";
import { useLedger } from "./LedgerProvider";
import { MigrationNotice } from "./OverviewView";
import { FilterChips, SectionCard, ledgerMoney } from "./ledgerUi";

type Filter = "all" | "active" | "inactive";

export function RecurringView() {
  const { data, model, open } = useLedger();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const groups = data.groups
    .filter((group) => (filter === "all" ? true : filter === "active" ? group.is_active : !group.is_active))
    .filter((group) => !term || group.name.toLowerCase().includes(term))
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <MigrationNotice />
      <SectionCard
        title="Recurring groups"
        description="Everyone in a group pays you their amount every period. Unpaid periods stay owed."
        action={
          <div className="flex items-center gap-2">
            <SectionRefreshIndicator scope="ledger" className="rounded-full bg-glass-strong px-2 py-1" />
            <Button size="sm" disabled={!data.available} leftIcon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "group" })}>
              New group
            </Button>
          </div>
        }
      >
        <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-glass-input px-3">
          <Search className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search groups" aria-label="Search groups" className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm" />
        </label>
        <div className="mt-4">
          <FilterChips
            label="Filter groups"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const summary = model.groupSummaries.get(group.id);
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => open({ kind: "groupDetails", groupId: group.id })}
                className="glass rounded-2xl p-4 text-left transition-transform hover:-translate-y-0.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <CalendarSync className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className={group.is_active ? "rounded-full bg-positive/12 px-2 py-0.5 text-[10px] font-semibold text-positive" : "rounded-full bg-glass-hover px-2 py-0.5 text-[10px] font-semibold text-fg-muted"}>
                    {group.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="mt-3 truncate text-sm font-semibold text-fg">{group.name}</p>
                <p className="text-xs text-fg-subtle">
                  {ledgerFrequencyLabel(group.frequency, group.frequency_interval)} · {summary?.activeMembers ?? 0} member{summary?.activeMembers === 1 ? "" : "s"}
                </p>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[11px] text-fg-subtle">Outstanding</p>
                    <p className="font-money text-base font-bold text-fg">{ledgerMoney(summary?.outstandingCents ?? 0, group.currency)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-fg-subtle">Collected</p>
                    <p className="font-money text-sm font-semibold text-positive">{ledgerMoney(summary?.collectedCents ?? 0, group.currency)}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {groups.length === 0 && (
          <EmptyState
            icon={<CalendarSync className="h-5 w-5" />}
            title={data.groups.length ? "No matching groups" : "No recurring groups yet"}
            description={data.groups.length ? "Try another search or filter." : "Track shared subscriptions like Spotify Family or Netflix."}
            action={
              !data.groups.length && data.available ? (
                <Button size="sm" onClick={() => open({ kind: "group" })}>
                  New group
                </Button>
              ) : undefined
            }
          />
        )}
      </SectionCard>
    </div>
  );
}
