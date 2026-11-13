"use client";

import { useState } from "react";
import { Plus, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionRefreshIndicator } from "@/components/ui/SectionRefreshIndicator";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { useLedger } from "./LedgerProvider";
import { MigrationNotice } from "./OverviewView";
import { FilterChips, SectionCard, ledgerMoney } from "./ledgerUi";

type Filter = "active" | "owing" | "archived";

export function PeopleView() {
  const { data, model, currency, open } = useLedger();
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const people = data.people
    .filter((person) => (filter === "archived" ? !!person.archived_at : !person.archived_at))
    .filter((person) => filter !== "owing" || (model.personSummaries.get(person.id)?.outstandingCents ?? 0) > 0)
    .filter((person) => !term || person.name.toLowerCase().includes(term) || (person.phone ?? "").includes(term))
    .sort((a, b) => (model.personSummaries.get(b.id)?.outstandingCents ?? 0) - (model.personSummaries.get(a.id)?.outstandingCents ?? 0) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <MigrationNotice />
      <SectionCard
        title="People"
        description="Each person is added once and reused across groups, expenses and dues."
        action={
          <div className="flex items-center gap-2">
            <SectionRefreshIndicator scope="ledger" className="rounded-full bg-glass-strong px-2 py-1" />
            <Button size="sm" disabled={!data.available} leftIcon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "person" })}>
              Add person
            </Button>
          </div>
        }
      >
        <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-glass-input px-3">
          <Search className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or phone" aria-label="Search people" className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm" />
        </label>
        <div className="mt-4">
          <FilterChips
            label="Filter people"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "active", label: "Active" },
              { value: "owing", label: "Owes me" },
              { value: "archived", label: "Archived" },
            ]}
          />
        </div>

        <ul className="mt-4 grid gap-2 md:grid-cols-2">
          {people.map((person) => {
            const summary = model.personSummaries.get(person.id);
            return (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => open({ kind: "personDetails", personId: person.id })}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-glass-hover/50 px-3 py-3 text-left transition-colors hover:bg-glass-hover"
                >
                  <UserAvatar name={person.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">{person.name}</span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {summary?.activeMemberships ?? 0} active group{summary?.activeMemberships === 1 ? "" : "s"} · collected {ledgerMoney(summary?.collectedCents ?? 0, currency)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[10px] text-fg-subtle">Owes</span>
                    <span className={(summary?.outstandingCents ?? 0) > 0 ? "block font-money text-sm font-bold text-fg" : "block font-money text-sm font-bold text-positive"}>
                      {ledgerMoney(summary?.outstandingCents ?? 0, currency)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {people.length === 0 && (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title={data.people.length ? "No matching people" : "No people yet"}
            description={data.people.length ? "Try another search or filter." : "Add the people who owe you money."}
            action={
              !data.people.length && data.available ? (
                <Button size="sm" onClick={() => open({ kind: "person" })}>
                  Add person
                </Button>
              ) : undefined
            }
          />
        )}
      </SectionCard>
    </div>
  );
}
