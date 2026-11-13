"use client";

import { Pencil, Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import { formatLedgerDate, ledgerFrequencyLabel, memberStatus, rateOn } from "@/lib/ledger";
import { useLedger } from "./LedgerProvider";
import { ObligationRow } from "./ObligationParts";
import { ledgerMoney } from "./ledgerUi";

/** One person: what they owe, what they have paid, their groups and every due and payment. */
export function PersonDetailsModal({ personId }: { personId: string }) {
  const { data, model, today, open, close } = useLedger();
  const person = data.people.find((item) => item.id === personId);

  if (!person) {
    return (
      <Modal isOpen onClose={close} title="Person" size="lg">
        <p className="text-sm text-fg-muted">This person no longer exists.</p>
      </Modal>
    );
  }

  const summary = model.personSummaries.get(person.id);
  const obligations = [...(model.obligationsByPerson.get(person.id) ?? [])].sort((a, b) => {
    const left = model.balances.get(a.id)?.outstandingCents ?? 0;
    const right = model.balances.get(b.id)?.outstandingCents ?? 0;
    return Number(right > 0) - Number(left > 0) || b.due_date.localeCompare(a.due_date);
  });
  const memberships = data.members
    .filter((member) => member.person_id === person.id)
    .map((member) => ({ member, group: data.groups.find((group) => group.id === member.group_id), status: memberStatus(data.spans, member.id), rate: rateOn(data.rates, member.id, today) }))
    .filter((item) => item.group);
  const payments = data.payments
    .filter((payment) => obligations.some((obligation) => obligation.id === payment.obligation_id))
    .sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.created_at.localeCompare(a.created_at));
  const currency = obligations[0]?.currency ?? "INR";

  return (
    <Modal isOpen onClose={close} title={person.name} description={[person.phone, person.archived_at ? "Archived" : null].filter(Boolean).join(" · ") || undefined} size="lg">
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Outstanding", ledgerMoney(summary?.outstandingCents ?? 0, currency)],
            ["Collected", ledgerMoney(summary?.collectedCents ?? 0, currency)],
            ["Active groups", String(summary?.activeMemberships ?? 0)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-glass-hover px-2 py-2.5">
              <p className="text-[10px] font-medium text-fg-subtle">{label}</p>
              <p className="font-money text-sm font-bold text-fg">{value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {!person.archived_at && (
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "due" })}>
              New due
            </Button>
          )}
          <Button size="sm" variant="outline" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => open({ kind: "person", personId: person.id })}>
            Edit
          </Button>
          {person.phone && (
            <a href={`tel:${person.phone.replace(/[^0-9+]/g, "")}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong px-3.5 text-xs font-semibold text-fg hover:bg-glass-hover">
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              Call
            </a>
          )}
        </div>
        {person.notes && <p className="rounded-xl border border-line bg-glass-hover px-3 py-2 text-xs text-fg-muted">{person.notes}</p>}

        {memberships.length > 0 && (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Recurring groups</h3>
            <ul className="space-y-1.5">
              {memberships.map(({ member, group, status, rate }) => (
                <li key={member.id}>
                  <button
                    type="button"
                    onClick={() => open({ kind: "groupDetails", groupId: group!.id })}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-glass-hover/50 px-3 py-2 text-left hover:bg-glass-hover"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-fg">{group!.name}</span>
                      <span className="block text-[11px] text-fg-subtle">
                        {ledgerFrequencyLabel(group!.frequency, group!.frequency_interval)}
                        {rate ? ` · ${ledgerMoney(Math.round(Number(rate.amount) * 100), group!.currency)}` : ""}
                      </span>
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", status === "active" ? "bg-positive/12 text-positive" : status === "paused" ? "bg-warning/12 text-warning" : "bg-glass-hover text-fg-muted")}>
                      {status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Dues</h3>
          {obligations.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-fg-subtle">Nothing owed yet.</p>
          ) : (
            <div className="space-y-1.5">
              {obligations.map((obligation) => (
                <ObligationRow key={obligation.id} obligation={obligation} showPerson={false} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Payment history</h3>
          {payments.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-fg-subtle">No payments yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {payments.map((payment) => {
                const obligation = obligations.find((item) => item.id === payment.obligation_id);
                return (
                  <li key={payment.id}>
                    <button
                      type="button"
                      onClick={() => open({ kind: "payment", paymentId: payment.id })}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-glass-hover/50 px-3 py-2 text-left hover:bg-glass-hover"
                    >
                      <span className="min-w-0">
                        <span className={cn("block font-money text-sm font-semibold text-fg", payment.voided_at && "line-through opacity-60")}>
                          {ledgerMoney(Math.round(Number(payment.amount) * 100), obligation?.currency ?? currency)}
                        </span>
                        <span className="block truncate text-[11px] text-fg-subtle">
                          {formatLedgerDate(payment.paid_on)} · {obligation?.title}
                        </span>
                      </span>
                      {payment.voided_at && <span className="rounded-full bg-glass-hover px-2 py-0.5 text-[10px] font-semibold text-fg-muted">Voided</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
