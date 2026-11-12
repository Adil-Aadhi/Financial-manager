"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, CalendarSync, CheckCircle2, HandCoins, Plus, ReceiptText, Users, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionRefreshIndicator } from "@/components/ui/SectionRefreshIndicator";
import { formatLedgerDate } from "@/lib/ledger";
import { useLedger } from "./LedgerProvider";
import { SectionCard, StatTile, ledgerMoney } from "./ledgerUi";

export function MigrationNotice() {
  const { data } = useLedger();
  if (data.available) return null;
  return (
    <Alert variant="warning" title="Database setup required">
      Apply the Personal Ledger migration before adding anything here.
    </Alert>
  );
}

export function OverviewView() {
  const { data, model, currency, open } = useLedger();
  const { overview } = model;
  const people = new Map(data.people.map((person) => [person.id, person]));
  const owingPeople = data.people
    .map((person) => ({ person, cents: model.personSummaries.get(person.id)?.outstandingCents ?? 0 }))
    .filter((item) => item.cents > 0)
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 5);

  const methodCards = [
    {
      href: "/ledger/recurring",
      title: "Recurring Dues",
      icon: <CalendarSync className="h-5 w-5" />,
      detail: `${data.groups.filter((group) => group.is_active).length} active group${data.groups.filter((group) => group.is_active).length === 1 ? "" : "s"}`,
      cents: data.groups.reduce((sum, group) => sum + (model.groupSummaries.get(group.id)?.outstandingCents ?? 0), 0),
    },
    {
      href: "/ledger/expenses",
      title: "Shared Expenses",
      icon: <ReceiptText className="h-5 w-5" />,
      detail: `${data.expenses.length} expense${data.expenses.length === 1 ? "" : "s"}`,
      cents: data.expenses.reduce((sum, expense) => sum + (model.expenseSummaries.get(expense.id)?.outstandingCents ?? 0), 0),
    },
    {
      href: "/ledger/dues",
      title: "Manual Dues",
      icon: <HandCoins className="h-5 w-5" />,
      detail: `${data.obligations.filter((obligation) => obligation.source === "manual").length} due${data.obligations.filter((obligation) => obligation.source === "manual").length === 1 ? "" : "s"}`,
      cents: data.obligations
        .filter((obligation) => obligation.source === "manual")
        .reduce((sum, obligation) => sum + (model.balances.get(obligation.id)?.outstandingCents ?? 0), 0),
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <MigrationNotice />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile
          label="Total outstanding"
          value={ledgerMoney(overview.outstandingCents, currency)}
          icon={<Wallet className="h-4 w-4" />}
          danger={overview.overdueCents > 0}
          hint={overview.overdueCents > 0 ? `${ledgerMoney(overview.overdueCents, currency)} overdue` : undefined}
        />
        <StatTile label="Total collected" value={ledgerMoney(overview.collectedCents, currency)} icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatTile label="People" value={String(overview.peopleCount)} icon={<Users className="h-4 w-4" />} />
        <StatTile label="Recurring groups" value={String(overview.activeGroups)} icon={<CalendarSync className="h-4 w-4" />} hint="Active" />
      </div>
      {overview.otherCurrencyDues > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {overview.otherCurrencyDues} due{overview.otherCurrencyDues === 1 ? " is" : "s are"} in another currency and not included in these totals.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {methodCards.map((card) => (
          <Link key={card.href} href={card.href} className="glass glass-edge group flex items-center gap-3 rounded-2xl p-4 transition-transform hover:-translate-y-0.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">{card.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-fg">{card.title}</span>
              <span className="block text-xs text-fg-subtle">{card.detail}</span>
              <span className="block font-money text-sm font-bold text-fg">{ledgerMoney(card.cents, currency)} outstanding</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard title="Recent activity" className="lg:col-span-3" action={<SectionRefreshIndicator scope="ledger" className="rounded-full bg-glass-strong px-2 py-1" />}>
          {overview.recent.length === 0 ? (
            <EmptyState
              icon={<Wallet className="h-5 w-5" />}
              title="No activity yet"
              description="Add a due, a shared expense or a recurring group to start tracking."
              action={
                data.available ? (
                  <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "chooser" })}>
                    Add
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="space-y-1.5">
              {overview.recent.map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <button
                    type="button"
                    onClick={() => open(item.kind === "payment" ? { kind: "payment", paymentId: item.id } : { kind: "obligation", obligationId: item.obligationId })}
                    className="flex w-full items-center gap-3 rounded-xl border border-line bg-glass-hover/50 px-3 py-2.5 text-left hover:bg-glass-hover"
                  >
                    <span className={item.kind === "payment" ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-positive/12 text-positive" : "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"}>
                      {item.kind === "payment" ? <CheckCircle2 className="h-4 w-4" /> : <HandCoins className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-fg">
                        {people.get(item.personId)?.name ?? "Unknown"} {item.kind === "payment" ? "paid" : "owes"} {ledgerMoney(item.amountCents, currency)}
                      </span>
                      <span className="block truncate text-[11px] text-fg-subtle">
                        {item.title} · {formatLedgerDate(item.date)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Who owes you" className="lg:col-span-2">
          {owingPeople.length === 0 ? (
            <EmptyState icon={<Users className="h-5 w-5" />} title="Nobody owes you right now" />
          ) : (
            <ul className="space-y-1.5">
              {owingPeople.map(({ person, cents }) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => open({ kind: "personDetails", personId: person.id })}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-glass-hover/50 px-3 py-2.5 text-left hover:bg-glass-hover"
                  >
                    <span className="truncate text-sm font-semibold text-fg">{person.name}</span>
                    <span className="font-money text-sm font-bold text-fg">{ledgerMoney(cents, currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
