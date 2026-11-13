import "client-only";

import type { LedgerEntity } from "@/lib/ledger";
import { offlineDb } from "@/lib/offline/db";
import type { LedgerLocalRows } from "@/lib/offline/ledgerOverlay";

/** Every Personal Ledger table, for listing in Dexie transactions. */
export function ledgerTableList() {
  return [
    offlineDb.ledgerPeople,
    offlineDb.ledgerGroups,
    offlineDb.ledgerMembers,
    offlineDb.ledgerRates,
    offlineDb.ledgerSpans,
    offlineDb.ledgerExpenses,
    offlineDb.ledgerObligations,
    offlineDb.ledgerPayments,
  ];
}

export function ledgerTableFor(entity: LedgerEntity) {
  switch (entity) {
    case "ledger_person":
      return offlineDb.ledgerPeople;
    case "ledger_group":
      return offlineDb.ledgerGroups;
    case "ledger_member":
      return offlineDb.ledgerMembers;
    case "ledger_rate":
      return offlineDb.ledgerRates;
    case "ledger_span":
      return offlineDb.ledgerSpans;
    case "ledger_expense":
      return offlineDb.ledgerExpenses;
    case "ledger_obligation":
      return offlineDb.ledgerObligations;
    case "ledger_payment":
      return offlineDb.ledgerPayments;
  }
}

/** Reads this owner's ledger rows. Call inside a transaction that lists ledgerTableList(). */
export async function readLedgerRows(ownerId: string): Promise<LedgerLocalRows> {
  const [people, groups, members, rates, spans, expenses, obligations, payments] = await Promise.all([
    offlineDb.ledgerPeople.where("ownerId").equals(ownerId).toArray(),
    offlineDb.ledgerGroups.where("ownerId").equals(ownerId).toArray(),
    offlineDb.ledgerMembers.where("ownerId").equals(ownerId).toArray(),
    offlineDb.ledgerRates.where("ownerId").equals(ownerId).toArray(),
    offlineDb.ledgerSpans.where("ownerId").equals(ownerId).toArray(),
    offlineDb.ledgerExpenses.where("ownerId").equals(ownerId).toArray(),
    offlineDb.ledgerObligations.where("ownerId").equals(ownerId).toArray(),
    offlineDb.ledgerPayments.where("ownerId").equals(ownerId).toArray(),
  ]);
  return { people, groups, members, rates, spans, expenses, obligations, payments };
}

/** Replaces this owner's ledger rows with `rows`. Call inside a transaction that lists ledgerTableList(). */
export async function replaceLedgerRows(ownerId: string, rows: LedgerLocalRows) {
  await Promise.all(ledgerTableList().map((table) => table.where("ownerId").equals(ownerId).delete()));
  await offlineDb.ledgerPeople.bulkPut(rows.people);
  await offlineDb.ledgerGroups.bulkPut(rows.groups);
  await offlineDb.ledgerMembers.bulkPut(rows.members);
  await offlineDb.ledgerRates.bulkPut(rows.rates);
  await offlineDb.ledgerSpans.bulkPut(rows.spans);
  await offlineDb.ledgerExpenses.bulkPut(rows.expenses);
  await offlineDb.ledgerObligations.bulkPut(rows.obligations);
  await offlineDb.ledgerPayments.bulkPut(rows.payments);
}
