"use client";

import { useMemo, useState } from "react";
import { History, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Select";
import { SectionRefreshIndicator } from "@/components/ui/SectionRefreshIndicator";
import { cn } from "@/lib/cn";
import { formatLedgerDate } from "@/lib/ledger";
import { useLedger } from "./LedgerProvider";
import { MigrationNotice } from "./OverviewView";
import { useObligationSource } from "./ObligationParts";
import { SectionCard, ledgerMoney } from "./ledgerUi";

/** Every payment ever recorded, newest first. Voided payments stay listed and don't count. */
export function PaymentsView() {
  const { data, open } = useLedger();
  const sourceLabel = useObligationSource();
  const [personId, setPersonId] = useState("");
  const obligations = useMemo(() => new Map(data.obligations.map((obligation) => [obligation.id, obligation])), [data.obligations]);
  const people = useMemo(() => new Map(data.people.map((person) => [person.id, person])), [data.people]);

  const payments = useMemo(
    () =>
      data.payments
        .filter((payment) => !personId || obligations.get(payment.obligation_id)?.person_id === personId)
        .sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.created_at.localeCompare(a.created_at)),
    [data.payments, obligations, personId]
  );
  const countedCents = payments.filter((payment) => !payment.voided_at).reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0);
  const currency = payments.length ? obligations.get(payments[0].obligation_id)?.currency ?? "INR" : "INR";

  return (
    <div className="space-y-4">
      <MigrationNotice />
      <SectionCard
        title="Payment history"
        description={payments.length ? `${payments.filter((payment) => !payment.voided_at).length} payments · ${ledgerMoney(countedCents, currency)}` : undefined}
        action={
          <div className="flex items-center gap-2">
            <SectionRefreshIndicator scope="ledger" className="rounded-full bg-glass-strong px-2 py-1" />
            <Button size="sm" disabled={!data.available} leftIcon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "payment" })}>
              Record payment
            </Button>
          </div>
        }
      >
        {data.people.length > 0 && (
          <Select label="Person" value={personId} onChange={(event) => setPersonId(event.target.value)} className="text-base sm:text-sm">
            <option value="">Everyone</option>
            {[...data.people].sort((a, b) => a.name.localeCompare(b.name)).map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        )}

        <ul className="mt-4 space-y-2">
          {payments.map((payment) => {
            const obligation = obligations.get(payment.obligation_id);
            return (
              <li key={payment.id}>
                <button
                  type="button"
                  onClick={() => open({ kind: "payment", paymentId: payment.id })}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-glass-hover/50 px-3 py-3 text-left transition-colors hover:bg-glass-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-fg">{obligation ? people.get(obligation.person_id)?.name ?? "Unknown" : "Unknown"}</span>
                      {payment.voided_at && <span className="rounded-full bg-glass-hover px-2 py-0.5 text-[10px] font-semibold text-fg-muted">Voided</span>}
                    </span>
                    <span className="block truncate text-xs text-fg-muted">{obligation ? `${obligation.title} · ${sourceLabel(obligation)}` : "Removed due"}</span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {formatLedgerDate(payment.paid_on)}
                      {payment.note ? ` · ${payment.note}` : ""}
                    </span>
                  </span>
                  <span className={cn("shrink-0 font-money text-sm font-bold", payment.voided_at ? "text-fg-subtle line-through" : "text-positive")}>
                    {ledgerMoney(Math.round(Number(payment.amount) * 100), obligation?.currency ?? currency)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {payments.length === 0 && (
          <EmptyState
            icon={<History className="h-5 w-5" />}
            title={data.payments.length ? "No payments for this person" : "No payments yet"}
            description={data.payments.length ? undefined : "Payments you record against dues show up here."}
          />
        )}
      </SectionCard>
    </div>
  );
}
