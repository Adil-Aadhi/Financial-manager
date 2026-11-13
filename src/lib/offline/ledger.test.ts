import { beforeEach, describe, expect, it } from "vitest";
import { offlineDb, type OutboxEntry } from "./db";
import { applyLedgerChangesLocally, generateRecurringDuesLocally } from "./ledgerMutations";
import { overlayOutbox } from "./snapshotOverlay";
import { dependsOn, selectRunnableEntries } from "./queuePolicy";
import { readLedgerRows } from "./ledgerTables";
import { LocalMutationError } from "./mutations";
import { buildLedgerModel, earlierDueChanges, planMemberPayment, recurringObligationId, type LedgerChange } from "@/lib/ledger";
import { dailyBudgetToday } from "@/lib/dailyBudget";

const ownerId = "11111111-1111-4111-8111-111111111111";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RAHUL = uuid(1);
const ASHA = uuid(2);
const GROUP = uuid(10);
const MEMBER = uuid(11);
const DUE = uuid(20);

const person = (id: string, name: string): LedgerChange => ({ entity: "ledger_person", op: "CREATE", id, payload: { name, phone: "", notes: "", archived_at: null } });
const manualDue = (extra: Record<string, unknown> = {}): LedgerChange => ({
  entity: "ledger_obligation", op: "CREATE", id: DUE,
  payload: { person_id: RAHUL, source: "manual", origin: "manual", title: "Personal borrowing", amount: 500, due_date: "2026-11-12", currency: "INR", note: "", ...extra },
});
const pay = (id: number, amount: number, extra: Record<string, unknown> = {}): LedgerChange => ({
  entity: "ledger_payment", op: "CREATE", id: uuid(id),
  payload: { obligation_id: DUE, amount, paid_on: "2026-11-12", note: "", voided_at: null, ...extra },
});
const group: LedgerChange = {
  entity: "ledger_group", op: "CREATE", id: GROUP,
  payload: { name: "Spotify Family", description: "", frequency: "monthly", frequency_interval: 1, start_date: "2026-09-01", due_offset_days: 7, is_active: true, currency: "INR" },
};
const member: LedgerChange = { entity: "ledger_member", op: "CREATE", id: MEMBER, payload: { group_id: GROUP, person_id: RAHUL, joined_on: "2026-09-01" } };
const rate: LedgerChange = { entity: "ledger_rate", op: "CREATE", id: uuid(12), payload: { member_id: MEMBER, effective_from: "2026-09-01", amount: 30 } };
const span: LedgerChange = { entity: "ledger_span", op: "CREATE", id: uuid(13), payload: { member_id: MEMBER, from_date: "2026-09-01", to_date: null, end_reason: null } };

const outbox = () => offlineDb.outbox.where("ownerId").equals(ownerId).sortBy("seq");

beforeEach(async () => {
  await offlineDb.delete();
  await offlineDb.open();
  await offlineDb.syncMeta.put({
    ownerId, completedAt: new Date().toISOString(), budgetAvailable: true, dailyBudgetAvailable: true, subscriptionsAvailable: true,
    billsAvailable: true, installmentsAvailable: true, ledgerAvailable: true,
    server: { accounts: 0, transactions: 0, income: 0, expense: 0 }, local: { accounts: 0, transactions: 0, income: 0, expense: 0 }, totalsMatch: true,
  });
  await applyLedgerChangesLocally(ownerId, [person(RAHUL, "Rahul"), person(ASHA, "Asha")]);
});

describe("ledger offline writes", () => {
  it("saves people, a due and payments on this device and queues each one", async () => {
    await applyLedgerChangesLocally(ownerId, [manualDue()]);
    await applyLedgerChangesLocally(ownerId, [pay(30, 200)]);
    const rows = await readLedgerRows(ownerId);
    expect(rows.people.map((row) => row.name).sort()).toEqual(["Asha", "Rahul"]);
    expect(rows.obligations).toHaveLength(1);
    expect(rows.payments).toHaveLength(1);
    expect((await outbox()).map((entry) => `${entry.entity}:${entry.op}`)).toEqual([
      "ledger_person:CREATE", "ledger_person:CREATE", "ledger_obligation:CREATE", "ledger_payment:CREATE",
    ]);
  });

  it("tracks partial payments and refuses an overpayment without saving anything", async () => {
    await applyLedgerChangesLocally(ownerId, [manualDue()]);
    await applyLedgerChangesLocally(ownerId, [pay(30, 200)]);
    await expect(applyLedgerChangesLocally(ownerId, [pay(31, 400)])).rejects.toBeInstanceOf(LocalMutationError);
    await applyLedgerChangesLocally(ownerId, [pay(31, 300)]);
    const rows = await readLedgerRows(ownerId);
    const model = buildLedgerModel(rows, "2026-11-12", "INR");
    expect(model.balances.get(DUE)).toMatchObject({ paidCents: 50_000, outstandingCents: 0, status: "paid" });
    expect(rows.payments).toHaveLength(2);
    // 2 people + 1 due + 2 payments; the refused overpayment queued nothing.
    expect(await outbox()).toHaveLength(5);
  });

  it("fixes the currency of a due, an expense and a group once payment history or dues exist", async () => {
    const update = (entity: LedgerChange["entity"], id: string, payload: Record<string, unknown>): LedgerChange => ({ entity, op: "UPDATE", id, payload });
    // A due: changeable until it has a payment.
    await applyLedgerChangesLocally(ownerId, [manualDue()]);
    await applyLedgerChangesLocally(ownerId, [update("ledger_obligation", DUE, { currency: "USD" })]);
    await applyLedgerChangesLocally(ownerId, [pay(30, 100)]);
    await expect(applyLedgerChangesLocally(ownerId, [update("ledger_obligation", DUE, { currency: "INR" })])).rejects.toThrow(/currency/);
    expect((await readLedgerRows(ownerId)).obligations[0].currency).toBe("USD");

    // An expense: changeable until a share has a payment.
    const shares = [{ id: uuid(51), person_id: RAHUL, amount: 600 }, { id: uuid(52), person_id: ASHA, amount: 400 }];
    const expense = (currency: string): Record<string, unknown> => ({ title: "KSEB", total_amount: 1000, expense_date: "2026-11-10", allow_unallocated: false, currency, shares });
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_expense", op: "CREATE", id: uuid(50), payload: expense("INR") }]);
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_expense", op: "UPDATE", id: uuid(50), payload: expense("USD") }]);
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_payment", op: "CREATE", id: uuid(60), payload: { obligation_id: uuid(51), amount: 50, paid_on: "2026-11-11", note: "", voided_at: null } }]);
    await expect(applyLedgerChangesLocally(ownerId, [{ entity: "ledger_expense", op: "UPDATE", id: uuid(50), payload: expense("INR") }])).rejects.toThrow(/currency/);

    // A group: changeable until it has generated dues.
    await applyLedgerChangesLocally(ownerId, [group, member, rate, span]);
    await applyLedgerChangesLocally(ownerId, [update("ledger_group", GROUP, { currency: "USD" })]);
    await applyLedgerChangesLocally(ownerId, [update("ledger_group", GROUP, { currency: "INR" })]);
    await generateRecurringDuesLocally(ownerId, "2026-11-12");
    await expect(applyLedgerChangesLocally(ownerId, [update("ledger_group", GROUP, { currency: "USD" })])).rejects.toThrow(/currency/);
    await applyLedgerChangesLocally(ownerId, [update("ledger_group", GROUP, { name: "Spotify Premium" })]);
  });

  it("does not add a second payment when the same payment is saved again", async () => {
    await applyLedgerChangesLocally(ownerId, [manualDue()]);
    await applyLedgerChangesLocally(ownerId, [pay(30, 200)]);
    await applyLedgerChangesLocally(ownerId, [pay(30, 200)]);
    expect((await readLedgerRows(ownerId)).payments).toHaveLength(1);
    expect((await outbox()).filter((entry) => entry.entity === "ledger_payment")).toHaveLength(1);
  });

  it("voids a payment rather than deleting it, and the balance reopens", async () => {
    await applyLedgerChangesLocally(ownerId, [manualDue(), pay(30, 500)]);
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_payment", op: "UPDATE", id: uuid(30), payload: { voided_at: new Date().toISOString() } }]);
    const rows = await readLedgerRows(ownerId);
    expect(rows.payments).toHaveLength(1);
    expect(buildLedgerModel(rows, "2026-11-12", "INR").balances.get(DUE)).toMatchObject({ outstandingCents: 50_000 });
    await expect(applyLedgerChangesLocally(ownerId, [{ entity: "ledger_payment", op: "DELETE", id: uuid(30), payload: {} }])).rejects.toBeInstanceOf(LocalMutationError);
  });

  it("saves a shared expense with its shares and keeps payment history when the expense is edited", async () => {
    const shares = [{ id: uuid(51), person_id: RAHUL, amount: 600 }, { id: uuid(52), person_id: ASHA, amount: 400 }];
    const expense = (extra: Record<string, unknown> = {}): LedgerChange => ({
      entity: "ledger_expense", op: "CREATE", id: uuid(50),
      payload: { title: "KSEB bill", description: "", total_amount: 1000, expense_date: "2026-11-10", category: "Electricity", allow_unallocated: false, currency: "INR", shares, ...extra },
    });
    await applyLedgerChangesLocally(ownerId, [expense()]);
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_payment", op: "CREATE", id: uuid(60), payload: { obligation_id: uuid(51), amount: 250, paid_on: "2026-11-11", note: "", voided_at: null } }]);
    await applyLedgerChangesLocally(ownerId, [{ ...expense({ title: "KSEB Oct bill" }), op: "UPDATE" }]);
    const rows = await readLedgerRows(ownerId);
    expect(rows.expenses[0]).toMatchObject({ title: "KSEB Oct bill" });
    expect(rows.obligations.map((row) => [row.person_id, Number(row.amount), row.title])).toEqual(
      expect.arrayContaining([[RAHUL, 600, "KSEB Oct bill"], [ASHA, 400, "KSEB Oct bill"]])
    );
    expect(rows.payments).toHaveLength(1);
    // Rahul has paid, so he can't be removed or cut below what he paid.
    await expect(applyLedgerChangesLocally(ownerId, [{ ...expense({ total_amount: 400, shares: [shares[1]] }), op: "UPDATE" }])).rejects.toBeInstanceOf(LocalMutationError);
    await expect(applyLedgerChangesLocally(ownerId, [{ ...expense({ total_amount: 1000, shares: [{ ...shares[0], amount: 100 }, { ...shares[1], amount: 900 }] }), op: "UPDATE" }])).rejects.toBeInstanceOf(LocalMutationError);
  });

  it("refuses a shared expense whose shares do not add up", async () => {
    const bad: LedgerChange = {
      entity: "ledger_expense", op: "CREATE", id: uuid(50),
      payload: { title: "KSEB", total_amount: 1000, expense_date: "2026-11-10", currency: "INR", allow_unallocated: false, shares: [{ id: uuid(51), person_id: RAHUL, amount: 300 }] },
    };
    await expect(applyLedgerChangesLocally(ownerId, [bad])).rejects.toBeInstanceOf(LocalMutationError);
  });

  it("is atomic: one invalid change in a group saves none of the group", async () => {
    const before = await outbox();
    await expect(applyLedgerChangesLocally(ownerId, [manualDue(), pay(30, 900)])).rejects.toBeInstanceOf(LocalMutationError);
    expect(await outbox()).toHaveLength(before.length);
    expect((await readLedgerRows(ownerId)).obligations).toHaveLength(0);
  });

  it("never touches accounts, transactions or any other financial table", async () => {
    await applyLedgerChangesLocally(ownerId, [manualDue(), pay(30, 100)]);
    expect(await offlineDb.accounts.count()).toBe(0);
    expect(await offlineDb.transactions.count()).toBe(0);
    expect(await offlineDb.categories.count()).toBe(0);
    expect(await offlineDb.monthlyBudgets.count()).toBe(0);
    expect((await outbox()).every((entry) => entry.entity.startsWith("ledger_"))).toBe(true);
  });
});

describe("recurring dues offline", () => {
  beforeEach(async () => {
    await applyLedgerChangesLocally(ownerId, [group, member, rate, span]);
  });

  it("generates each period once and never again", async () => {
    expect(await generateRecurringDuesLocally(ownerId, "2026-11-12")).toBe(3);
    expect(await generateRecurringDuesLocally(ownerId, "2026-11-12")).toBe(0);
    const rows = await readLedgerRows(ownerId);
    expect(rows.obligations.filter((row) => row.source === "recurring").map((row) => row.period_start).sort()).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
    // A later day in the same month adds nothing; the next month adds exactly one.
    expect(await generateRecurringDuesLocally(ownerId, "2026-11-30")).toBe(0);
    expect(await generateRecurringDuesLocally(ownerId, "2026-12-01")).toBe(1);
  });

  it("keeps a missed month outstanding when a later month is paid", async () => {
    await generateRecurringDuesLocally(ownerId, "2026-11-12");
    const rows = await readLedgerRows(ownerId);
    const november = rows.obligations.find((row) => row.period_start === "2026-11-01")!;
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_payment", op: "CREATE", id: uuid(70), payload: { obligation_id: november.id, amount: 30, paid_on: "2026-11-12", note: "", voided_at: null } }]);
    const model = buildLedgerModel(await readLedgerRows(ownerId), "2026-11-12", "INR");
    expect(model.overview.outstandingCents).toBe(6_000); // Sep + Oct still owed
    expect(model.balances.get(november.id)).toMatchObject({ status: "paid" });
  });

  it("adds earlier unpaid periods that count as outstanding and are never regenerated or duplicated", async () => {
    await generateRecurringDuesLocally(ownerId, "2026-11-12");
    const rows = await readLedgerRows(ownerId);
    const changes = earlierDueChanges({ group: rows.groups[0], memberId: MEMBER, personId: RAHUL, count: 2, amount: 30 });
    await applyLedgerChangesLocally(ownerId, changes);
    // Adding the same periods again changes nothing.
    await applyLedgerChangesLocally(ownerId, changes);
    expect(await generateRecurringDuesLocally(ownerId, "2026-11-12")).toBe(0);
    const after = await readLedgerRows(ownerId);
    expect(after.obligations.filter((row) => row.source === "recurring")).toHaveLength(5); // Aug, Jul (earlier) + Sep, Oct, Nov
    expect(buildLedgerModel(after, "2026-11-12", "INR").overview.outstandingCents).toBe(15_000);
    // An earlier period is paid like any other.
    const july = after.obligations.find((row) => row.period_start === "2026-07-01")!;
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_payment", op: "CREATE", id: uuid(71), payload: { obligation_id: july.id, amount: 30, paid_on: "2026-11-12", note: "", voided_at: null } }]);
    expect(buildLedgerModel(await readLedgerRows(ownerId), "2026-11-12", "INR").overview.outstandingCents).toBe(12_000);
  });

  it("records a payment larger than what is owed, applying the extra to the next period without duplicates", async () => {
    await generateRecurringDuesLocally(ownerId, "2026-11-12");
    const rows = await readLedgerRows(ownerId);
    const balances = buildLedgerModel(rows, "2026-11-12", "INR").balances;
    const plan = planMemberPayment({ group: rows.groups[0], member: rows.members[0], spans: rows.spans, rates: rows.rates, obligations: rows.obligations, balances, amountCents: 10_000, today: "2026-11-12", advance: true });
    const changes: LedgerChange[] = [];
    plan.applications.forEach((application, index) => {
      if (application.newDue) {
        changes.push({
          entity: "ledger_obligation", op: "CREATE", id: application.obligationId,
          payload: { person_id: RAHUL, source: "recurring", group_id: GROUP, member_id: MEMBER, period_start: application.periodStart, title: "Spotify Family", amount: application.newDue.amount, due_date: application.newDue.dueDate, currency: "INR", note: "Paid in advance" },
        });
      }
      changes.push({ entity: "ledger_payment", op: "CREATE", id: uuid(90 + index), payload: { obligation_id: application.obligationId, amount: application.amountCents / 100, paid_on: "2026-11-12", note: "", voided_at: null } });
    });
    await applyLedgerChangesLocally(ownerId, changes);

    const after = await readLedgerRows(ownerId);
    const model = buildLedgerModel(after, "2026-11-12", "INR");
    // 90 owed + 30 upcoming - 100 paid = 20 still owed, all on the upcoming period.
    expect(model.overview.outstandingCents).toBe(2_000);
    expect(model.overview.collectedCents).toBe(10_000);
    const december = after.obligations.find((row) => row.period_start === "2026-12-01")!;
    expect(model.balances.get(december.id)).toMatchObject({ paidCents: 1_000, outstandingCents: 2_000 });
    // When December arrives, its due already exists, so nothing is created twice.
    expect(await generateRecurringDuesLocally(ownerId, "2026-12-02")).toBe(0);
    expect((await readLedgerRows(ownerId)).obligations.filter((row) => row.period_start === "2026-12-01")).toHaveLength(1);
  });

  it("deletes a due added by mistake, but not one the app generates or one with payments", async () => {
    await generateRecurringDuesLocally(ownerId, "2026-11-12");
    const rows = await readLedgerRows(ownerId);
    const remove = (id: string): LedgerChange => ({ entity: "ledger_obligation", op: "DELETE", id, payload: {} });

    // An earlier period added by mistake can be deleted.
    const earlier = earlierDueChanges({ group: rows.groups[0], memberId: MEMBER, personId: RAHUL, count: 1, amount: 30 });
    await applyLedgerChangesLocally(ownerId, earlier);
    await applyLedgerChangesLocally(ownerId, [remove(earlier[0].id)]);
    expect((await readLedgerRows(ownerId)).obligations.some((row) => row.id === earlier[0].id)).toBe(false);

    // A generated period would just come back, so it is refused.
    const november = rows.obligations.find((row) => row.period_start === "2026-11-01")!;
    await expect(applyLedgerChangesLocally(ownerId, [remove(november.id)])).rejects.toThrow(/created automatically/);

    // A due with a payment is kept for the history, even a voided one.
    await applyLedgerChangesLocally(ownerId, [manualDue(), pay(30, 100)]);
    await expect(applyLedgerChangesLocally(ownerId, [remove(DUE)])).rejects.toThrow(/payments/);
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_payment", op: "UPDATE", id: uuid(30), payload: { voided_at: new Date().toISOString() } }]);
    await expect(applyLedgerChangesLocally(ownerId, [remove(DUE)])).rejects.toThrow(/payments/);
  });

  it("deletes a due that was paid in advance for a future period only while it has no payment", async () => {
    await generateRecurringDuesLocally(ownerId, "2026-11-12");
    const rows = await readLedgerRows(ownerId);
    const advanceDue = (period: string): LedgerChange => ({
      entity: "ledger_obligation", op: "CREATE", id: recurringObligationId(MEMBER, period),
      payload: { person_id: RAHUL, source: "recurring", origin: "advance", group_id: GROUP, member_id: MEMBER, period_start: period, title: "Spotify Family", amount: 30, due_date: period, currency: "INR", note: "Paid in advance" },
    });
    const remove = (period: string): LedgerChange => ({ entity: "ledger_obligation", op: "DELETE", id: recurringObligationId(MEMBER, period), payload: {} });
    const has = async (period: string) => (await readLedgerRows(ownerId)).obligations.some((row) => row.id === recurringObligationId(MEMBER, period));

    // A period that is still in the future (far ahead, so this holds whatever today's date is).
    await applyLedgerChangesLocally(ownerId, [advanceDue("2099-01-01")]);
    await applyLedgerChangesLocally(ownerId, [remove("2099-01-01")]);
    expect(await has("2099-01-01")).toBe(false);

    // An advance due stated as such can't be for a period that has started or starts today.
    await expect(applyLedgerChangesLocally(ownerId, [advanceDue("2026-09-15")])).rejects.toThrow(/future/);
    await expect(applyLedgerChangesLocally(ownerId, [advanceDue(dailyBudgetToday())])).rejects.toThrow(/future/);
    expect(await has("2026-09-15")).toBe(false);

    // An older change that carried only the "Paid in advance" note is still read as an advance due,
    // and once its period has started it is kept.
    const legacy = advanceDue("2026-09-15");
    delete legacy.payload.origin;
    await applyLedgerChangesLocally(ownerId, [legacy]);
    await expect(applyLedgerChangesLocally(ownerId, [remove("2026-09-15")])).rejects.toThrow(/has started/);
    expect(await has("2026-09-15")).toBe(true);

    // A payment keeps even a future advance due.
    await applyLedgerChangesLocally(ownerId, [advanceDue("2099-02-01")]);
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_payment", op: "CREATE", id: uuid(96), payload: { obligation_id: recurringObligationId(MEMBER, "2099-02-01"), amount: 10, paid_on: "2026-11-12", note: "", voided_at: null } }]);
    await expect(applyLedgerChangesLocally(ownerId, [remove("2099-02-01")])).rejects.toThrow(/payments/);
    expect(rows.obligations).toHaveLength(3);
  });

  it("marks every kind of due with its origin when it is created", async () => {
    await applyLedgerChangesLocally(ownerId, [manualDue()]);
    await generateRecurringDuesLocally(ownerId, "2026-11-12");
    const rows = await readLedgerRows(ownerId);
    await applyLedgerChangesLocally(ownerId, earlierDueChanges({ group: rows.groups[0], memberId: MEMBER, personId: RAHUL, count: 1, amount: 30 }));
    const shares = [{ id: uuid(51), person_id: RAHUL, amount: 1000 }];
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_expense", op: "CREATE", id: uuid(50), payload: { title: "KSEB", total_amount: 1000, expense_date: "2026-11-10", allow_unallocated: false, currency: "INR", shares } }]);
    const origins = Object.fromEntries((await readLedgerRows(ownerId)).obligations.map((row) => [row.period_start ?? row.source, row.origin]));
    expect(origins).toMatchObject({ manual: "manual", shared: "shared", "2026-11-01": "generated", "2026-08-01": "earlier" });
    // A shared share can't be deleted on its own.
    await expect(applyLedgerChangesLocally(ownerId, [{ entity: "ledger_obligation", op: "DELETE", id: uuid(51), payload: {} }])).rejects.toThrow(/shared due/);
  });

  it("lets a single period's amount be adjusted, but never below what was paid", async () => {
    await generateRecurringDuesLocally(ownerId, "2026-11-12");
    const october = (await readLedgerRows(ownerId)).obligations.find((row) => row.period_start === "2026-10-01")!;
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_obligation", op: "UPDATE", id: october.id, payload: { amount: 10 } }]);
    const rows = await readLedgerRows(ownerId);
    expect(Object.fromEntries(rows.obligations.map((row) => [row.period_start, Number(row.amount)]))).toEqual({ "2026-09-01": 30, "2026-10-01": 10, "2026-11-01": 30 });
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_payment", op: "CREATE", id: uuid(95), payload: { obligation_id: october.id, amount: 10, paid_on: "2026-11-12", note: "", voided_at: null } }]);
    await expect(applyLedgerChangesLocally(ownerId, [{ entity: "ledger_obligation", op: "UPDATE", id: october.id, payload: { amount: 5 } }])).rejects.toBeInstanceOf(LocalMutationError);
  });

  it("applies a contribution change only from its date", async () => {
    await generateRecurringDuesLocally(ownerId, "2026-10-15");
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_rate", op: "CREATE", id: uuid(80), payload: { member_id: MEMBER, effective_from: "2026-11-01", amount: 45 } }]);
    await generateRecurringDuesLocally(ownerId, "2026-11-12");
    const rows = await readLedgerRows(ownerId);
    const amounts = Object.fromEntries(rows.obligations.map((row) => [row.period_start, Number(row.amount)]));
    expect(amounts).toEqual({ "2026-09-01": 30, "2026-10-01": 30, "2026-11-01": 45 });
  });

  it("stops generating while a member is paused", async () => {
    await generateRecurringDuesLocally(ownerId, "2026-10-15");
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_span", op: "UPDATE", id: uuid(13), payload: { to_date: "2026-11-01", end_reason: "paused" } }]);
    expect(await generateRecurringDuesLocally(ownerId, "2026-12-20")).toBe(0);
  });

  it("deletes a group created by mistake with its members and generated dues, and keeps the people", async () => {
    await generateRecurringDuesLocally(ownerId, "2026-11-12");
    expect((await readLedgerRows(ownerId)).obligations).toHaveLength(3);
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_group", op: "DELETE", id: GROUP, payload: {} }]);
    const rows = await readLedgerRows(ownerId);
    expect(rows.groups).toHaveLength(0);
    expect(rows.members).toHaveLength(0);
    expect(rows.rates).toHaveLength(0);
    expect(rows.spans).toHaveLength(0);
    expect(rows.obligations).toHaveLength(0);
    expect(rows.people.map((person) => person.name).sort()).toEqual(["Asha", "Rahul"]);
    // Nothing is generated for a group that no longer exists.
    expect(await generateRecurringDuesLocally(ownerId, "2026-12-20")).toBe(0);
    // The delete is queued behind the changes it depends on, to sync in order.
    const queue = await outbox();
    expect(queue.at(-1)).toMatchObject({ entity: "ledger_group", op: "DELETE" });
    expect(dependsOn(queue.at(-1)!, queue.find((entry) => entry.entity === "ledger_member")!)).toBe(true);
  });

  it("keeps a group that has payment history and removes nothing", async () => {
    await generateRecurringDuesLocally(ownerId, "2026-11-12");
    const november = (await readLedgerRows(ownerId)).obligations.find((row) => row.period_start === "2026-11-01")!;
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_payment", op: "CREATE", id: uuid(97), payload: { obligation_id: november.id, amount: 10, paid_on: "2026-11-12", note: "", voided_at: null } }]);
    const queued = (await outbox()).length;
    await expect(applyLedgerChangesLocally(ownerId, [{ entity: "ledger_group", op: "DELETE", id: GROUP, payload: {} }])).rejects.toThrow(/payments/);
    expect((await readLedgerRows(ownerId)).groups).toHaveLength(1);
    expect((await readLedgerRows(ownerId)).obligations).toHaveLength(3);
    expect(await outbox()).toHaveLength(queued);
  });

  it("will not change a group's schedule once it has dues", async () => {
    await generateRecurringDuesLocally(ownerId, "2026-11-12");
    await expect(
      applyLedgerChangesLocally(ownerId, [{ entity: "ledger_group", op: "UPDATE", id: GROUP, payload: { start_date: "2026-08-01" } }])
    ).rejects.toBeInstanceOf(LocalMutationError);
    await applyLedgerChangesLocally(ownerId, [{ entity: "ledger_group", op: "UPDATE", id: GROUP, payload: { name: "Spotify Premium" } }]);
  });
});

describe("ledger sync ordering and snapshots", () => {
  it("keeps a payment behind the due it belongs to", async () => {
    await applyLedgerChangesLocally(ownerId, [manualDue(), pay(30, 100)]);
    const [, , due, payment] = (await outbox()) as OutboxEntry[];
    expect(dependsOn(payment, due)).toBe(true);
    expect(dependsOn(due, payment)).toBe(false);
    // While the due is waiting to retry, the payment may not overtake it.
    const blocked = { ...due, status: "pending" as const, nextAttemptAt: Date.now() + 60_000 };
    const runnable = selectRunnableEntries([blocked, payment], Date.now(), 25);
    expect(runnable.map((entry) => entry.entity)).toEqual([]);
  });

  it("keeps every queued ledger change when a fresh server snapshot replaces the device copy", async () => {
    await applyLedgerChangesLocally(ownerId, [manualDue(), pay(30, 200)]);
    const entries = await outbox();
    const empty = { accounts: [], categories: [], transactions: [], budget: null };
    const rows = overlayOutbox(ownerId, { ...empty, ledger: undefined }, { ...empty, ledger: undefined }, entries);
    expect(rows.ledger?.people.map((row) => row.name).sort()).toEqual(["Asha", "Rahul"]);
    expect(rows.ledger?.obligations).toHaveLength(1);
    expect(rows.ledger?.payments).toHaveLength(1);
    expect(rows.accounts).toEqual([]);
    expect(rows.transactions).toEqual([]);
  });
});
