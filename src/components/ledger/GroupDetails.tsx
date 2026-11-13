"use client";

import { useState } from "react";
import { CalendarSync, History, Pause, Pencil, Play, Plus, TrendingUp, UserMinus, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import { MAX_EARLIER_PERIODS, earlierDueChanges, formatLedgerDate, ledgerFrequencyLabel, memberStatus, periodLabel, rateOn, type LedgerMemberRecord } from "@/lib/ledger";
import { useLedger } from "./LedgerProvider";
import { ObligationRow } from "./ObligationParts";
import { ledgerMoney, newId, useLedgerSave } from "./ledgerUi";

type PanelKind = "rate" | "pause" | "leave" | "resume" | "earlier";

const STATUS_STYLE = {
  active: "bg-positive/12 text-positive",
  paused: "bg-warning/12 text-warning",
  left: "bg-glass-hover text-fg-muted",
} as const;

/** One recurring group: its members, their contribution, and every period's dues. */
export function GroupDetailsModal({ groupId }: { groupId: string }) {
  const { data, model, today, open, close } = useLedger();
  const group = data.groups.find((item) => item.id === groupId);
  const [panel, setPanel] = useState<{ memberId: string; kind: PanelKind } | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (!group) {
    return (
      <Modal isOpen onClose={close} title="Group" size="lg">
        <p className="text-sm text-fg-muted">This group no longer exists.</p>
      </Modal>
    );
  }

  const summary = model.groupSummaries.get(group.id);
  const members = data.members
    .filter((member) => member.group_id === group.id)
    .map((member) => ({
      member,
      person: data.people.find((item) => item.id === member.person_id),
      status: memberStatus(data.spans, member.id),
      rate: rateOn(data.rates, member.id, today),
      outstandingCents: data.obligations
        .filter((obligation) => obligation.member_id === member.id)
        .reduce((sum, obligation) => sum + (model.balances.get(obligation.id)?.outstandingCents ?? 0), 0),
    }))
    .sort((a, b) => (a.person?.name ?? "").localeCompare(b.person?.name ?? ""));

  const periods = new Map<string, typeof data.obligations>();
  for (const obligation of data.obligations) {
    if (obligation.group_id !== group.id || !obligation.period_start) continue;
    const list = periods.get(obligation.period_start);
    if (list) list.push(obligation);
    else periods.set(obligation.period_start, [obligation]);
  }
  const orderedPeriods = [...periods.keys()].sort((a, b) => b.localeCompare(a));
  const visiblePeriods = showAll ? orderedPeriods : orderedPeriods.slice(0, 3);

  return (
    <Modal isOpen onClose={close} title={group.name} description={`${ledgerFrequencyLabel(group.frequency, group.frequency_interval)} · from ${formatLedgerDate(group.start_date)}${group.description ? ` · ${group.description}` : ""}`} size="lg">
      <div className="space-y-5">
        {!group.is_active && <Alert variant="warning">This group is inactive, so it isn&apos;t creating new dues.</Alert>}

        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Outstanding", ledgerMoney(summary?.outstandingCents ?? 0, group.currency)],
            ["Collected", ledgerMoney(summary?.collectedCents ?? 0, group.currency)],
            ["Active members", String(summary?.activeMembers ?? 0)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-glass-hover px-2 py-2.5">
              <p className="text-[10px] font-medium text-fg-subtle">{label}</p>
              <p className="font-money text-sm font-bold text-fg">{value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "member", groupId: group.id })}>
            Add person
          </Button>
          <Button size="sm" variant="outline" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => open({ kind: "group", groupId: group.id })}>
            Edit group
          </Button>
        </div>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Members</h3>
          {members.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-fg-subtle">No one is in this group yet.</p>
          ) : (
            <ul className="space-y-2">
              {members.map(({ member, person, status, rate, outstandingCents }) => (
                <li key={member.id} className="rounded-xl border border-line bg-glass-hover/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-fg">{person?.name ?? "Unknown"}</p>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", STATUS_STYLE[status])}>{status}</span>
                      </div>
                      <p className="text-[11px] text-fg-subtle">
                        {rate ? `${ledgerMoney(Math.round(Number(rate.amount) * 100), group.currency)} per period` : "No contribution set"}
                        {outstandingCents > 0 ? ` · owes ${ledgerMoney(outstandingCents, group.currency)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="secondary" leftIcon={<Wallet className="h-3.5 w-3.5" />} onClick={() => open({ kind: "memberPayment", memberId: member.id })}>
                        Receive
                      </Button>
                      <Button size="sm" variant="ghost" leftIcon={<TrendingUp className="h-3.5 w-3.5" />} onClick={() => setPanel({ memberId: member.id, kind: "rate" })}>
                        Amount
                      </Button>
                      <Button size="sm" variant="ghost" leftIcon={<History className="h-3.5 w-3.5" />} onClick={() => setPanel({ memberId: member.id, kind: "earlier" })}>
                        Earlier
                      </Button>
                      {status === "active" ? (
                        <>
                          <Button size="sm" variant="ghost" leftIcon={<Pause className="h-3.5 w-3.5" />} onClick={() => setPanel({ memberId: member.id, kind: "pause" })}>
                            Pause
                          </Button>
                          <Button size="sm" variant="ghost" leftIcon={<UserMinus className="h-3.5 w-3.5" />} onClick={() => setPanel({ memberId: member.id, kind: "leave" })}>
                            Leave
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" leftIcon={<Play className="h-3.5 w-3.5" />} onClick={() => setPanel({ memberId: member.id, kind: "resume" })}>
                          Resume
                        </Button>
                      )}
                    </div>
                  </div>
                  {panel?.memberId === member.id && <MemberPanel key={panel.kind} member={member} kind={panel.kind} onDone={() => setPanel(null)} />}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Dues by period</h3>
          {orderedPeriods.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-fg-subtle">
              Dues appear here from the group&apos;s starting date, one per person for each period.
            </p>
          ) : (
            <div className="space-y-4">
              {visiblePeriods.map((period) => (
                <div key={period}>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
                    <CalendarSync className="h-3.5 w-3.5" aria-hidden="true" />
                    {periodLabel(group, period)}
                  </p>
                  <div className="space-y-1.5">
                    {periods
                      .get(period)!
                      .sort((a, b) => (data.people.find((p) => p.id === a.person_id)?.name ?? "").localeCompare(data.people.find((p) => p.id === b.person_id)?.name ?? ""))
                      .map((obligation) => (
                        <ObligationRow key={obligation.id} obligation={obligation} />
                      ))}
                  </div>
                </div>
              ))}
              {orderedPeriods.length > 3 && (
                <Button size="sm" variant="ghost" onClick={() => setShowAll((value) => !value)}>
                  {showAll ? "Show recent only" : `Show earlier periods (${orderedPeriods.length - 3})`}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

/** Inline form under a member: change the contribution, pause, leave or resume. */
function MemberPanel({ member, kind, onDone }: { member: LedgerMemberRecord; kind: PanelKind; onDone: () => void }) {
  const { data, today } = useLedger();
  const { save, pending, error, setError } = useLedgerSave();
  const current = rateOn(data.rates, member.id, today);
  const [amount, setAmount] = useState(current ? String(Number(current.amount)) : "");
  const [date, setDate] = useState(today);
  const [count, setCount] = useState("1");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (kind === "earlier") {
      const group = data.groups.find((item) => item.id === member.group_id);
      const periods = Number(count);
      if (!group) return setError("This group no longer exists.");
      if (!(Number(amount) > 0)) return setError("Enter the amount owed for each period.");
      if (!Number.isInteger(periods) || periods < 1 || periods > MAX_EARLIER_PERIODS) return setError(`Enter 1 to ${MAX_EARLIER_PERIODS} periods.`);
      const existingPeriods = new Set(data.obligations.filter((obligation) => obligation.member_id === member.id && obligation.period_start).map((obligation) => obligation.period_start as string));
      const changes = earlierDueChanges({ group, memberId: member.id, personId: member.person_id, count: periods, amount: Number(amount), existingPeriods });
      if (changes.length === 0) return setError("Those earlier periods are already added.");
      save(changes, onDone);
      return;
    }
    if (kind === "rate") {
      if (!(Number(amount) > 0)) return setError("Enter a contribution greater than zero.");
      const sameDay = data.rates.find((rate) => rate.member_id === member.id && rate.effective_from === date);
      save(
        [
          sameDay
            ? { entity: "ledger_rate", op: "UPDATE", id: sameDay.id, payload: { amount: Number(amount) } }
            : { entity: "ledger_rate", op: "CREATE", id: newId(), payload: { member_id: member.id, effective_from: date, amount: Number(amount) } },
        ],
        onDone
      );
      return;
    }
    if (kind === "resume") {
      save([{ entity: "ledger_span", op: "CREATE", id: newId(), payload: { member_id: member.id, from_date: date, to_date: null, end_reason: null } }], onDone);
      return;
    }
    const openSpan = data.spans.find((span) => span.member_id === member.id && span.to_date === null);
    if (!openSpan) return setError("This member isn't active.");
    save([{ entity: "ledger_span", op: "UPDATE", id: openSpan.id, payload: { to_date: date, end_reason: kind === "leave" ? "left" : "paused" } }], onDone);
  };

  const copy = {
    earlier: { date: "", hint: "Adds unpaid dues for the periods just before this group started, newest first. Each is paid or edited like any other due." },
    rate: { date: "Applies from", hint: "Dues for periods starting on or after this date use the new amount. Earlier dues keep their amount." },
    pause: { date: "Pause from", hint: "No new dues are created from this date. Earlier dues stay and remain owed." },
    leave: { date: "Leaves on", hint: "No new dues are created from this date. Earlier dues stay and remain owed." },
    resume: { date: "Resume from", hint: "Dues start again with the first period on or after this date." },
  }[kind];

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 border-t border-line pt-3" noValidate>
      {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {kind === "earlier" && (
          <Input label="Earlier unpaid periods" type="number" inputMode="numeric" min="1" max={MAX_EARLIER_PERIODS} value={count} onChange={(event) => setCount(event.target.value)} className="text-base sm:text-sm" />
        )}
        {(kind === "rate" || kind === "earlier") && (
          <Input
            label={kind === "rate" ? "New contribution" : "Amount owed per period"}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="text-base font-money sm:text-sm"
          />
        )}
        {kind !== "earlier" && <Input label={copy.date} type="date" value={date} onChange={(event) => setDate(event.target.value)} className="text-base sm:text-sm" />}
      </div>
      <p className="text-[11px] text-fg-subtle">{copy.hint}</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" isLoading={pending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
