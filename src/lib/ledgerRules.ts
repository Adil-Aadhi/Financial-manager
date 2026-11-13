import { toCents } from "@/lib/dailyBudget";
import { dueDeleteBlock, type LedgerChange, type LedgerRows, type LedgerShare } from "@/lib/ledger";

/**
 * Business rules that depend on the rest of the ledger, checked on the device before a change is
 * saved offline. The database enforces the same rules again when the change syncs (unique keys,
 * guard triggers and the write functions), so a bypassed check can never corrupt the ledger.
 *
 * `columns` is the normalised row for a create or update (see the normalizers in ledger.ts) and
 * null for a delete.
 */
export function validateLedgerChange(
  rows: LedgerRows,
  change: LedgerChange,
  columns: Record<string, unknown> | null,
  today?: string
): string | null {
  const { entity, op, id } = change;
  const paidOn = (obligationId: string, excludePaymentId?: string) =>
    rows.payments
      .filter((payment) => payment.obligation_id === obligationId && !payment.voided_at && payment.id !== excludePaymentId)
      .reduce((sum, payment) => sum + toCents(payment.amount), 0);
  const hasPayments = (obligationId: string) => rows.payments.some((payment) => payment.obligation_id === obligationId);

  switch (entity) {
    case "ledger_person": {
      const person = rows.people.find((item) => item.id === id);
      if (op === "DELETE") {
        if (!person) return null;
        const used = rows.members.some((member) => member.person_id === id) || rows.obligations.some((obligation) => obligation.person_id === id);
        return used ? `${person.name} has history, so archive them instead of deleting.` : null;
      }
      if (op === "UPDATE" && !person) return "This person no longer exists.";
      if (columns && columns.archived_at === null) {
        const name = String(columns.name).toLowerCase();
        const duplicate = rows.people.find((item) => item.id !== id && !item.archived_at && item.name.trim().toLowerCase() === name);
        if (duplicate) return `${duplicate.name} is already in your people. Choose them instead of adding again.`;
      }
      return null;
    }

    case "ledger_group": {
      const group = rows.groups.find((item) => item.id === id);
      const used = rows.obligations.some((obligation) => obligation.group_id === id);
      if (op === "DELETE") {
        if (!group) return null;
        // Deleting a group removes its members and dues with it (nothing can regenerate them), so
        // it is allowed unless something under it has payment history.
        const dueIds = new Set(rows.obligations.filter((obligation) => obligation.group_id === id).map((obligation) => obligation.id));
        return rows.payments.some((payment) => dueIds.has(payment.obligation_id))
          ? "This group has payments, so it is kept for the history. Deactivate it instead."
          : null;
      }
      if (op === "UPDATE") {
        if (!group) return "This group no longer exists.";
        const changed =
          group.frequency !== columns?.frequency ||
          group.frequency_interval !== columns?.frequency_interval ||
          group.start_date !== columns?.start_date;
        if (changed && used) return "This group already has dues, so its schedule can't change.";
        if (group.currency !== columns?.currency && used) return "This group already has dues, so its currency can't change.";
      }
      return null;
    }

    case "ledger_member": {
      const member = rows.members.find((item) => item.id === id);
      if (op === "DELETE") {
        if (!member) return null;
        return rows.obligations.some((obligation) => obligation.member_id === id)
          ? "This member already has dues. Pause or remove them from the schedule instead."
          : null;
      }
      if (op === "UPDATE") return "A member can't be changed. Pause or remove them instead.";
      const person = rows.people.find((item) => item.id === columns?.person_id);
      if (!person) return "Choose one of your people.";
      if (person.archived_at) return `${person.name} is archived.`;
      if (!rows.groups.some((item) => item.id === columns?.group_id)) return "This group no longer exists.";
      if (rows.members.some((item) => item.id !== id && item.group_id === columns?.group_id && item.person_id === columns?.person_id)) {
        return `${person.name} is already in this group.`;
      }
      return null;
    }

    case "ledger_rate": {
      if (op === "DELETE") return "A contribution change can't be deleted. Add a new amount instead.";
      if (!rows.members.some((item) => item.id === columns?.member_id)) return "This member no longer exists.";
      return null;
    }

    case "ledger_span": {
      if (op === "DELETE") return "A membership period can't be deleted.";
      const memberId = columns?.member_id;
      if (!rows.members.some((item) => item.id === memberId)) return "This member no longer exists.";
      const own = rows.spans.filter((span) => span.member_id === memberId && span.id !== id);
      if (op === "CREATE") {
        if (own.some((span) => span.to_date === null)) return "This member is already active.";
        const latestEnd = own.reduce((latest, span) => (span.to_date && span.to_date > latest ? span.to_date : latest), "");
        if (latestEnd && String(columns?.from_date) < latestEnd) return "A member can't start again before their last break ended.";
      } else if (!rows.spans.some((span) => span.id === id)) {
        return "This membership period no longer exists.";
      }
      return null;
    }

    case "ledger_obligation": {
      const obligation = rows.obligations.find((item) => item.id === id);
      if (op === "DELETE") {
        if (!obligation) return null;
        return dueDeleteBlock({ obligation, groups: rows.groups, hasPayments: hasPayments(id), today });
      }
      const person = rows.people.find((item) => item.id === columns?.person_id);
      if (!person) return "Choose one of your people.";
      if (op === "CREATE") {
        if (obligation) return null;
        if (columns?.source === "manual" && person.archived_at) return `${person.name} is archived.`;
        if (columns?.source === "recurring") {
          if (!rows.members.some((item) => item.id === columns.member_id)) return "This member no longer exists.";
          const duplicate = rows.obligations.some((item) => item.member_id === columns.member_id && item.period_start === columns.period_start);
          if (duplicate) return "This period already has a due.";
          // Same rule as the database: an advance due stated as such must be for a future period.
          if (columns.origin === "advance" && today && String(columns.period_start) <= today) {
            return "An advance due must be for a period in the future.";
          }
        }
        return null;
      }
      if (!obligation) return "This due no longer exists.";
      if (obligation.source === "shared") return "Edit the expense to change a shared due.";
      if (obligation.person_id !== columns?.person_id) return "A due can't change who owes it.";
      if (obligation.currency !== columns?.currency && hasPayments(id)) return "This due already has payments, so its currency can't change.";
      if (toCents(columns?.amount as number) < paidOn(id)) return "The amount can't be lower than what has already been paid.";
      return null;
    }

    case "ledger_expense": {
      const sharesOf = rows.obligations.filter((obligation) => obligation.expense_id === id);
      if (op === "DELETE") {
        return sharesOf.some((share) => hasPayments(share.id)) ? "This expense has payments, so it is kept for the history." : null;
      }
      const shares = (columns?.shares ?? []) as LedgerShare[];
      const current = rows.expenses.find((item) => item.id === id);
      if (current && current.currency !== columns?.currency && sharesOf.some((share) => hasPayments(share.id))) {
        return "This expense already has payments, so its currency can't change.";
      }
      for (const share of shares) {
        const person = rows.people.find((item) => item.id === share.person_id);
        if (!person) return "Choose your people from the list.";
        const existing = sharesOf.find((item) => item.id === share.id);
        if (!existing && person.archived_at) return `${person.name} is archived.`;
        if (existing && existing.person_id !== share.person_id) return "A share can't move to another person.";
        if (existing && toCents(share.amount) < paidOn(existing.id)) {
          return `${person.name} has already paid more than the new share.`;
        }
      }
      for (const share of sharesOf) {
        if (!shares.some((item) => item.id === share.id) && hasPayments(share.id)) {
          const person = rows.people.find((item) => item.id === share.person_id);
          return `${person?.name ?? "Someone"} has payments, so they can't be removed from this expense.`;
        }
      }
      if (op === "UPDATE" && !rows.expenses.some((item) => item.id === id)) return "This expense no longer exists.";
      return null;
    }

    case "ledger_payment": {
      if (op === "DELETE") return "Payments are never deleted. Void it instead.";
      const obligation = rows.obligations.find((item) => item.id === columns?.obligation_id);
      if (!obligation) return "This due no longer exists.";
      const payment = rows.payments.find((item) => item.id === id);
      if (op === "UPDATE") {
        if (!payment) return "This payment no longer exists.";
        if (payment.obligation_id !== columns?.obligation_id) return "A payment can't move to another due.";
      }
      if (columns?.voided_at === null) {
        const remaining = toCents(obligation.amount) - paidOn(obligation.id, id);
        if (toCents(columns.amount as number) > remaining) {
          return remaining <= 0
            ? "This due is already fully paid."
            : `This payment is more than the remaining balance (${(remaining / 100).toFixed(2)}).`;
        }
      }
      return null;
    }
  }
}
