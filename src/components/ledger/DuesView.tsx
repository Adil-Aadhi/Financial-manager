"use client";

import { useState } from "react";
import { HandCoins, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionRefreshIndicator } from "@/components/ui/SectionRefreshIndicator";
import { useLedger } from "./LedgerProvider";
import { ObligationRow } from "./ObligationParts";
import { MigrationNotice } from "./OverviewView";
import { FilterChips, SectionCard } from "./ledgerUi";

type Filter = "all" | "outstanding" | "overdue" | "paid";

export function DuesView() {
  const { data, model, open } = useLedger();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const people = new Map(data.people.map((person) => [person.id, person]));

  const dues = data.obligations
    .filter((obligation) => obligation.source === "manual")
    .filter((obligation) => {
      const balance = model.balances.get(obligation.id);
      if (!balance) return false;
      return filter === "all" ? true : filter === "paid" ? balance.status === "paid" : filter === "overdue" ? balance.status === "overdue" : balance.outstandingCents > 0;
    })
    .filter((obligation) => !term || obligation.title.toLowerCase().includes(term) || (people.get(obligation.person_id)?.name ?? "").toLowerCase().includes(term))
    .sort((a, b) => {
      const left = model.balances.get(a.id)?.outstandingCents ?? 0;
      const right = model.balances.get(b.id)?.outstandingCents ?? 0;
      return Number(right > 0) - Number(left > 0) || b.due_date.localeCompare(a.due_date);
    });
  const totalManual = data.obligations.filter((obligation) => obligation.source === "manual").length;

  return (
    <div className="space-y-4">
      <MigrationNotice />
      <SectionCard
        title="Manual dues"
        description="Money someone owes you, recorded in a few taps."
        action={
          <div className="flex items-center gap-2">
            <SectionRefreshIndicator scope="ledger" className="rounded-full bg-glass-strong px-2 py-1" />
            <Button size="sm" disabled={!data.available} leftIcon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "due" })}>
              New due
            </Button>
          </div>
        }
      >
        <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-glass-input px-3">
          <Search className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by person or description" aria-label="Search dues" className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm" />
        </label>
        <div className="mt-4">
          <FilterChips
            label="Filter dues"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "outstanding", label: "Outstanding" },
              { value: "overdue", label: "Overdue" },
              { value: "paid", label: "Paid" },
            ]}
          />
        </div>
        <div className="mt-4 space-y-2">
          {dues.map((obligation) => (
            <ObligationRow key={obligation.id} obligation={obligation} />
          ))}
        </div>
        {dues.length === 0 && (
          <EmptyState
            icon={<HandCoins className="h-5 w-5" />}
            title={totalManual ? "No matching dues" : "No manual dues yet"}
            description={totalManual ? "Try another search or filter." : "Record money you lent or paid for someone."}
            action={
              !totalManual && data.available ? (
                <Button size="sm" onClick={() => open({ kind: "due" })}>
                  New due
                </Button>
              ) : undefined
            }
          />
        )}
      </SectionCard>
    </div>
  );
}
