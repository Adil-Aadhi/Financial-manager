"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { LEDGER_FREQUENCIES, MAX_EARLIER_PERIODS, earlierDueChanges, type LedgerChange, type LedgerFrequency } from "@/lib/ledger";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import { useLedger } from "./LedgerProvider";
import { EMPTY_PERSON_CHOICE, PersonPicker, resolvePersonChoice, type PersonChoice } from "./PersonPicker";
import { FormSectionTitle, newId, useLedgerSave } from "./ledgerUi";

interface MemberRow {
  key: string;
  choice: PersonChoice;
  /** Blank means "use the default contribution". */
  amount: string;
  joinedOn: string;
}

/** The changes that add one member: the person (if new), the membership, its first rate and its first active span. */
export function memberChanges(input: { groupId: string; personId: string; amount: number; joinedOn: string }): LedgerChange[] {
  const memberId = newId();
  return [
    { entity: "ledger_member", op: "CREATE", id: memberId, payload: { group_id: input.groupId, person_id: input.personId, joined_on: input.joinedOn } },
    { entity: "ledger_rate", op: "CREATE", id: newId(), payload: { member_id: memberId, effective_from: input.joinedOn, amount: input.amount } },
    { entity: "ledger_span", op: "CREATE", id: newId(), payload: { member_id: memberId, from_date: input.joinedOn, to_date: null, end_reason: null } },
  ];
}

/** Create or edit a recurring group. Once it has dues, its schedule is fixed. */
export function GroupFormModal({ groupId }: { groupId?: string }) {
  const { data, today, currency, close, closeAll } = useLedger();
  const online = useOnlineStatus();
  const existing = groupId ? data.groups.find((item) => item.id === groupId) ?? null : null;
  const [id] = useState(() => existing?.id ?? newId());
  const locked = !!existing && data.obligations.some((obligation) => obligation.group_id === existing.id);

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [frequency, setFrequency] = useState<LedgerFrequency>(existing?.frequency ?? "monthly");
  const [interval, setIntervalValue] = useState(String(existing?.frequency_interval ?? 1));
  const [startDate, setStartDate] = useState(existing?.start_date ?? today);
  const [dueOffset, setDueOffset] = useState(String(existing?.due_offset_days ?? 7));
  const [isActive, setIsActive] = useState(existing?.is_active ?? true);
  const [defaultAmount, setDefaultAmount] = useState("");
  const [rows, setRows] = useState<MemberRow[]>(() => (existing ? [] : [blank(today)]));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { save, pending, error, setError } = useLedgerSave();

  // A group created by mistake can be deleted with its members and dues, unless any of its dues has
  // a payment (then it is kept for the history and can only be deactivated).
  const groupDues = existing ? data.obligations.filter((obligation) => obligation.group_id === existing.id) : [];
  const dueCount = groupDues.length;
  const memberCount = existing ? data.members.filter((member) => member.group_id === existing.id).length : 0;
  const deleteBlock = groupDues.some((due) => data.payments.some((payment) => payment.obligation_id === due.id))
    ? "This group has payments, so it is kept for the history. Untick Active above to stop new dues instead."
    : null;

  const custom = frequency === "custom_days" || frequency === "custom_months";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Enter a group name, e.g. Spotify Family.");
    const changes: LedgerChange[] = [];
    const payload = {
      name,
      description,
      frequency,
      frequency_interval: custom ? Number(interval) : 1,
      start_date: startDate,
      due_offset_days: Number(dueOffset || 0),
      is_active: isActive,
      currency: existing?.currency ?? currency,
    };
    changes.push({ entity: "ledger_group", op: existing ? "UPDATE" : "CREATE", id, payload });

    if (!existing) {
      const pendingPeople = new Map<string, string>();
      const used = new Set<string>();
      for (const row of rows) {
        if (!row.choice.personId) continue; // an untouched row is ignored
        const resolved = resolvePersonChoice(row.choice, data.people, pendingPeople);
        if ("error" in resolved) return setError(resolved.error);
        if (used.has(resolved.id)) return setError("Each person can be added to a group once.");
        used.add(resolved.id);
        const amount = Number(row.amount || defaultAmount);
        if (!(amount > 0)) return setError("Enter each person's contribution.");
        if (resolved.change) changes.push(resolved.change);
        changes.push(...memberChanges({ groupId: id, personId: resolved.id, amount, joinedOn: row.joinedOn || startDate }));
      }
    }
    save(changes, close);
  };

  return (
    <Modal isOpen onClose={close} title={existing ? "Edit group" : "New recurring group"} description="People who each pay you a fixed amount on a schedule." size="lg">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
        {!online && <Alert variant="info">Saved on this device and synced when you reconnect.</Alert>}

        <section className="space-y-4">
          <FormSectionTitle>Group</FormSectionTitle>
          <Input label="Group name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Spotify Family" required className="text-base sm:text-sm" />
          <Input label="Description (optional)" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} className="text-base sm:text-sm" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="How often" value={frequency} disabled={locked} onChange={(event) => setFrequency(event.target.value as LedgerFrequency)} className="text-base sm:text-sm">
              {LEDGER_FREQUENCIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
            {custom && (
              <Input
                label={frequency === "custom_days" ? "Every how many days" : "Every how many months"}
                type="number"
                inputMode="numeric"
                min="1"
                value={interval}
                disabled={locked}
                onChange={(event) => setIntervalValue(event.target.value)}
                className="text-base sm:text-sm"
              />
            )}
            <Input label="Starting date" type="date" value={startDate} disabled={locked} onChange={(event) => setStartDate(event.target.value)} required className="text-base sm:text-sm" />
            <Input
              label="Due after (days)"
              type="number"
              inputMode="numeric"
              min="0"
              max="365"
              value={dueOffset}
              onChange={(event) => setDueOffset(event.target.value)}
              helperText="Each payment is due this many days after its period starts."
              className="text-base sm:text-sm"
            />
          </div>
          {locked && <p className="text-xs text-fg-subtle">This group already has dues, so its schedule can&apos;t change.</p>}
          {existing && <Checkbox checked={isActive} onChange={(event) => setIsActive(event.target.checked)} label="Active" description="An inactive group stops creating new dues. Existing dues stay." />}
        </section>

        {!existing && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <FormSectionTitle>People</FormSectionTitle>
              <Button type="button" size="sm" variant="secondary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setRows((list) => [...list, blank(startDate)])}>
                Person
              </Button>
            </div>
            <Input
              label="Contribution each"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={defaultAmount}
              onChange={(event) => setDefaultAmount(event.target.value)}
              helperText="Used for everyone below unless you set their own amount."
              className="text-base font-money sm:text-sm"
            />
            <ul className="space-y-3">
              {rows.map((row) => (
                <li key={row.key} className="space-y-2 rounded-xl border border-line bg-glass-hover/50 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <PersonPicker
                        people={data.people}
                        value={row.choice}
                        onChange={(choice) => setRows((list) => list.map((item) => (item.key === row.key ? { ...item, choice } : item)))}
                        excludeIds={rows.map((item) => item.choice.personId).filter((value) => value && value !== "new" && value !== row.choice.personId)}
                      />
                    </div>
                    <Button type="button" variant="ghost" size="sm" aria-label="Remove person" className="mt-6 px-2" onClick={() => setRows((list) => list.filter((item) => item.key !== row.key))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      label="Their amount (optional)"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={row.amount}
                      placeholder={defaultAmount}
                      onChange={(event) => setRows((list) => list.map((item) => (item.key === row.key ? { ...item, amount: event.target.value } : item)))}
                      className="text-base font-money sm:text-sm"
                    />
                    <Input
                      label="Joined"
                      type="date"
                      value={row.joinedOn}
                      onChange={(event) => setRows((list) => list.map((item) => (item.key === row.key ? { ...item, joinedOn: event.target.value } : item)))}
                      className="text-base sm:text-sm"
                    />
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-fg-subtle">You can add or change people later from the group.</p>
          </section>
        )}

        <Button type="submit" className="w-full" isLoading={pending}>
          {existing ? "Save changes" : "Create group"}
        </Button>

        {existing && (
          <section className="space-y-2 border-t border-line pt-4">
            {deleteBlock ? (
              <p className="text-[11px] text-fg-subtle">{deleteBlock}</p>
            ) : confirmingDelete ? (
              <div className="space-y-3 rounded-xl border border-danger/25 bg-danger/8 px-3 py-3">
                <p className="text-xs text-fg">
                  Delete <span className="font-semibold">{existing.name}</span>
                  {memberCount > 0 || dueCount > 0
                    ? ` with its ${memberCount} member${memberCount === 1 ? "" : "s"} and ${dueCount} due${dueCount === 1 ? "" : "s"}`
                    : ""}
                  ? This can&apos;t be undone.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    isLoading={pending}
                    onClick={() => save([{ entity: "ledger_group", op: "DELETE", id, payload: {} }], closeAll)}
                  >
                    Delete group
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setConfirmingDelete(false)}>
                    Keep
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="ghost" size="sm" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmingDelete(true)}>
                Delete group
              </Button>
            )}
          </section>
        )}
      </form>
    </Modal>
  );
}

function blank(joinedOn: string): MemberRow {
  return { key: newId(), choice: EMPTY_PERSON_CHOICE, amount: "", joinedOn };
}

/** Add one person to an existing group. */
export function MemberFormModal({ groupId }: { groupId: string }) {
  const { data, today, close } = useLedger();
  const group = data.groups.find((item) => item.id === groupId);
  const [choice, setChoice] = useState<PersonChoice>(EMPTY_PERSON_CHOICE);
  const [amount, setAmount] = useState("");
  const [joinedOn, setJoinedOn] = useState(today > (group?.start_date ?? today) ? today : (group?.start_date ?? today));
  const [earlier, setEarlier] = useState("");
  const { save, pending, error, setError } = useLedgerSave();
  const inGroup = data.members.filter((member) => member.group_id === groupId).map((member) => member.person_id);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const resolved = resolvePersonChoice(choice, data.people, new Map());
    if ("error" in resolved) return setError(resolved.error);
    if (inGroup.includes(resolved.id)) return setError("This person is already in the group.");
    if (!(Number(amount) > 0)) return setError("Enter their contribution.");
    const count = Number(earlier || 0);
    if (!Number.isInteger(count) || count < 0 || count > MAX_EARLIER_PERIODS) return setError(`Earlier unpaid periods must be from 0 to ${MAX_EARLIER_PERIODS}.`);
    const changes: LedgerChange[] = [];
    if (resolved.change) changes.push(resolved.change);
    const member = memberChanges({ groupId, personId: resolved.id, amount: Number(amount), joinedOn });
    changes.push(...member);
    if (count > 0 && group) {
      changes.push(...earlierDueChanges({ group, memberId: member[0].id, personId: resolved.id, count, amount: Number(amount) }));
    }
    save(changes, close);
  };

  return (
    <Modal isOpen onClose={close} title="Add person" description={group?.name} size="sm">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
        <PersonPicker people={data.people} value={choice} onChange={setChoice} excludeIds={inGroup} />
        <Input label="Contribution" type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} required className="text-base font-money sm:text-sm" />
        <Input label="Joined" type="date" value={joinedOn} onChange={(event) => setJoinedOn(event.target.value)} required helperText="Dues start with the first period on or after this date." className="text-base sm:text-sm" />
        <Input
          label="Earlier unpaid periods (optional)"
          type="number"
          inputMode="numeric"
          min="0"
          max={MAX_EARLIER_PERIODS}
          value={earlier}
          onChange={(event) => setEarlier(event.target.value)}
          helperText="Periods before this group started that they still owe, at the amount above. You can edit amounts later."
          className="text-base sm:text-sm"
        />
        <Button type="submit" className="w-full" isLoading={pending}>
          Add to group
        </Button>
      </form>
    </Modal>
  );
}
