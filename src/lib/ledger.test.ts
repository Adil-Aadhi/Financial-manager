import { describe, expect, it } from "vitest";
import {
  addCalendarMonths,
  buildLedgerModel,
  dueDeleteBlock,
  dueOrigin,
  earlierDueChanges,
  missingRecurringObligations,
  normalizeExpense,
  normalizeGroup,
  obligationBalance,
  periodStartsThrough,
  planMemberPayment,
  recurringObligationId,
  splitEqually,
  type LedgerGroupRecord,
  type LedgerMemberRecord,
  type LedgerObligationRecord,
  type LedgerPaymentRecord,
  type LedgerRateRecord,
  type LedgerRows,
  type LedgerSpanRecord,
} from "./ledger";
import { validateLedgerChange } from "./ledgerRules";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = uuid(999);
const stamp = "2026-09-01T00:00:00.000Z";

const group = (extra: Partial<LedgerGroupRecord> = {}): LedgerGroupRecord => ({
  id: uuid(10), user_id: USER, name: "Spotify Family", description: null, frequency: "monthly", frequency_interval: 1,
  start_date: "2026-09-01", due_offset_days: 7, is_active: true, currency: "INR", created_at: stamp, updated_at: stamp, ...extra,
});
const member = (n: number, extra: Partial<LedgerMemberRecord> = {}): LedgerMemberRecord => ({
  id: uuid(100 + n), user_id: USER, group_id: uuid(10), person_id: uuid(200 + n), joined_on: "2026-09-01", created_at: stamp, updated_at: stamp, ...extra,
});
const span = (n: number, from = "2026-09-01", to: string | null = null, reason: "paused" | "left" | null = null, id = uuid(300 + n)): LedgerSpanRecord => ({
  id, user_id: USER, member_id: uuid(100 + n), from_date: from, to_date: to, end_reason: reason, created_at: stamp, updated_at: stamp,
});
const rate = (n: number, amount: number, from = "2026-09-01"): LedgerRateRecord => ({
  id: uuid(400 + n * 10 + Number(from.slice(5, 7))), user_id: USER, member_id: uuid(100 + n), effective_from: from, amount, created_at: stamp, updated_at: stamp,
});

describe("calendar maths", () => {
  it("clamps to the last day of the month and counts from the start date, never chained", () => {
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addCalendarMonths("2026-11-15", 14)).toBe("2028-01-15");
  });

  it("lists each period start up to today", () => {
    expect(periodStartsThrough(group(), "2026-11-12")).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
    expect(periodStartsThrough(group({ frequency: "weekly", start_date: "2026-11-01" }), "2026-11-16")).toEqual(["2026-11-01", "2026-11-08", "2026-11-15"]);
    expect(periodStartsThrough(group({ frequency: "yearly", start_date: "2024-03-10" }), "2026-11-12")).toEqual(["2024-03-10", "2025-03-10", "2026-03-10"]);
    expect(periodStartsThrough(group({ frequency: "custom_days", frequency_interval: 10, start_date: "2026-11-01" }), "2026-11-25")).toEqual(["2026-11-01", "2026-11-11", "2026-11-21"]);
    expect(periodStartsThrough(group({ start_date: "2027-01-01" }), "2026-11-12")).toEqual([]);
  });

  it("splits money equally in cents without losing a paisa", () => {
    expect(splitEqually(100_000, 3)).toEqual([33_334, 33_333, 33_333]);
    expect(splitEqually(100_000, 3).reduce((a, b) => a + b, 0)).toBe(100_000);
  });
});

describe("recurring obligations", () => {
  const base = {
    groups: [group()],
    members: [member(1), member(2), member(3)],
    spans: [span(1), span(2), span(3)],
    rates: [rate(1, 30), rate(2, 30), rate(3, 30)],
    obligations: [] as LedgerObligationRecord[],
    today: "2026-11-12",
  };

  it("generates one obligation per active member per period", () => {
    const missing = missingRecurringObligations(base);
    expect(missing).toHaveLength(9);
    expect(missing.every((item) => item.amount === 30)).toBe(true);
    expect(missing[0]).toMatchObject({ periodStart: "2026-09-01", dueDate: "2026-09-08" });
  });

  it("never generates a period twice", () => {
    const first = missingRecurringObligations(base);
    const stored = first.map(
      (item): LedgerObligationRecord => ({
        id: item.id, user_id: USER, person_id: item.personId, source: "recurring", group_id: item.groupId, member_id: item.memberId,
        period_start: item.periodStart, expense_id: null, title: item.title, amount: item.amount, due_date: item.dueDate,
        currency: item.currency, note: null, created_at: stamp, updated_at: stamp,
      })
    );
    expect(missingRecurringObligations({ ...base, obligations: stored })).toEqual([]);
    // One period missing on this device is the only one created.
    expect(missingRecurringObligations({ ...base, obligations: stored.slice(1) })).toHaveLength(1);
  });

  it("gives the same period the same id on every device, and different periods different ids", () => {
    expect(recurringObligationId(uuid(101), "2026-09-01")).toBe(recurringObligationId(uuid(101), "2026-09-01"));
    expect(recurringObligationId(uuid(101), "2026-09-01")).not.toBe(recurringObligationId(uuid(101), "2026-10-01"));
    expect(recurringObligationId(uuid(101), "2026-09-01")).not.toBe(recurringObligationId(uuid(102), "2026-09-01"));
    expect(recurringObligationId(uuid(101), "2026-09-01")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("uses the rate in force at the start of each period, so a change never rewrites history", () => {
    const missing = missingRecurringObligations({ ...base, rates: [rate(1, 30), rate(1, 45, "2026-11-01"), rate(2, 30), rate(3, 30)] });
    const first = missing.filter((item) => item.memberId === uuid(101));
    expect(first.map((item) => [item.periodStart, item.amount])).toEqual([
      ["2026-09-01", 30],
      ["2026-10-01", 30],
      ["2026-11-01", 45],
    ]);
  });

  it("skips periods while a member is paused and resumes afterwards", () => {
    const spans = [span(1, "2026-09-01", "2026-10-01", "paused", uuid(311)), span(1, "2026-11-01", null, null, uuid(312)), span(2), span(3)];
    const periods = missingRecurringObligations({ ...base, spans }).filter((item) => item.memberId === uuid(101)).map((item) => item.periodStart);
    expect(periods).toEqual(["2026-09-01", "2026-11-01"]);
  });

  it("gives a member who left no further dues, and a member who joins later no earlier ones", () => {
    const left = missingRecurringObligations({ ...base, spans: [span(1, "2026-09-01", "2026-11-01", "left"), span(2), span(3)] });
    expect(left.filter((item) => item.memberId === uuid(101)).map((item) => item.periodStart)).toEqual(["2026-09-01", "2026-10-01"]);
    const joined = missingRecurringObligations({ ...base, spans: [span(1, "2026-10-15"), span(2), span(3)] });
    expect(joined.filter((item) => item.memberId === uuid(101)).map((item) => item.periodStart)).toEqual(["2026-11-01"]);
  });

  it("generates nothing for an inactive group", () => {
    expect(missingRecurringObligations({ ...base, groups: [group({ is_active: false })] })).toEqual([]);
  });
});

describe("earlier unpaid periods", () => {
  it("creates one recurring due per earlier period, before the group's start, with stable ids", () => {
    const changes = earlierDueChanges({ group: group({ start_date: "2026-11-12", due_offset_days: 7 }), memberId: uuid(101), personId: uuid(201), count: 2, amount: 30 });
    expect(changes.map((change) => change.payload.period_start)).toEqual(["2026-10-12", "2026-09-12"]);
    expect(changes.map((change) => change.payload.due_date)).toEqual(["2026-10-19", "2026-09-19"]);
    expect(changes.every((change) => change.payload.source === "recurring" && change.payload.amount === 30)).toBe(true);
    expect(changes[0].id).toBe(recurringObligationId(uuid(101), "2026-10-12"));
  });

  it("skips periods that already exist and caps the count", () => {
    const skipped = earlierDueChanges({ group: group({ start_date: "2026-11-12" }), memberId: uuid(101), personId: uuid(201), count: 2, amount: 30, existingPeriods: new Set(["2026-10-12"]) });
    expect(skipped.map((change) => change.payload.period_start)).toEqual(["2026-09-12"]);
    expect(earlierDueChanges({ group: group({ start_date: "2026-11-12" }), memberId: uuid(101), personId: uuid(201), count: 999, amount: 30 })).toHaveLength(24);
  });

  it("works for weekly groups", () => {
    const changes = earlierDueChanges({ group: group({ frequency: "weekly", start_date: "2026-11-12" }), memberId: uuid(101), personId: uuid(201), count: 2, amount: 10 });
    expect(changes.map((change) => change.payload.period_start)).toEqual(["2026-11-05", "2026-10-29"]);
  });
});

describe("which dues can be deleted", () => {
  const groups = [group({ start_date: "2026-09-01" })];
  const base = { source: "recurring" as const, group_id: uuid(10), period_start: "2026-10-01", note: null };
  const block = (obligation: Parameters<typeof dueDeleteBlock>[0]["obligation"], hasPayments = false, today = "2026-11-12") =>
    dueDeleteBlock({ obligation, groups, hasPayments, today });

  it("allows a manual due, an earlier period and a future advance period without payments", () => {
    expect(block({ ...base, source: "manual", origin: "manual", group_id: null, period_start: null })).toBeNull();
    expect(block({ ...base, origin: "earlier", period_start: "2026-08-01" })).toBeNull();
    expect(block({ ...base, origin: "advance", period_start: "2026-12-01" })).toBeNull();
  });

  it("refuses a generated due, an advance period that has started, and a shared due", () => {
    expect(block({ ...base, origin: "generated" })).toMatch(/created automatically/);
    expect(block({ ...base, origin: "advance", period_start: "2026-11-12" })).toMatch(/has started/);
    expect(block({ ...base, origin: "advance", period_start: "2026-10-01" })).toMatch(/has started/);
    expect(block({ ...base, source: "shared", origin: "shared", group_id: null, period_start: null })).toMatch(/shared due/);
  });

  it("refuses every origin once there is payment history", () => {
    for (const origin of ["manual", "earlier", "advance"] as const) {
      expect(block({ ...base, source: origin === "manual" ? "manual" : "recurring", origin, period_start: "2099-01-01" }, true)).toMatch(/payments/);
    }
  });

  it("reads an older cached row without an origin the way the migration backfills it", () => {
    expect(block({ ...base, period_start: "2026-08-01" })).toBeNull(); // before the group's start: earlier
    expect(block({ ...base, note: "Earlier unpaid period" })).toBeNull();
    expect(block({ ...base, note: "Paid in advance", period_start: "2099-01-01" })).toBeNull();
    expect(block({ ...base })).toMatch(/created automatically/); // otherwise generated
    expect(dueOrigin({ ...base, source: "manual", note: null }, groups)).toBe("manual");
  });
});

describe("paying a member across periods and ahead", () => {
  const setup = () => {
    const rows = {
      groups: [group()], members: [member(1)], spans: [span(1)], rates: [rate(1, 30)], obligations: [] as LedgerObligationRecord[], today: "2026-11-12",
    };
    rows.obligations = missingRecurringObligations(rows).map(
      (item): LedgerObligationRecord => ({
        id: item.id, user_id: USER, person_id: item.personId, source: "recurring", group_id: item.groupId, member_id: item.memberId,
        period_start: item.periodStart, expense_id: null, title: item.title, amount: item.amount, due_date: item.dueDate,
        currency: item.currency, note: null, created_at: stamp, updated_at: stamp,
      })
    );
    const model = buildLedgerModel({ people: [], groups: rows.groups, members: rows.members, rates: rows.rates, spans: rows.spans, expenses: [], obligations: rows.obligations, payments: [] }, rows.today, "INR");
    return { rows, balances: model.balances };
  };
  const plan = (amountCents: number, advance: boolean) => {
    const { rows, balances } = setup();
    return planMemberPayment({ group: rows.groups[0], member: rows.members[0], spans: rows.spans, rates: rows.rates, obligations: rows.obligations, balances, amountCents, today: rows.today, advance });
  };

  it("applies a part payment to the oldest period first", () => {
    const result = plan(2_000, true);
    expect(result.applications).toHaveLength(1);
    expect(result.applications[0]).toMatchObject({ periodStart: "2026-09-01", amountCents: 2_000, upcoming: false });
    expect(result.unappliedCents).toBe(0);
  });

  it("clears every owed period, then puts the extra toward the next period, part paid", () => {
    const result = plan(10_000, true);
    expect(result.applications.map((item) => [item.periodStart, item.amountCents, item.upcoming])).toEqual([
      ["2026-09-01", 3_000, false],
      ["2026-10-01", 3_000, false],
      ["2026-11-01", 3_000, false],
      ["2026-12-01", 1_000, true],
    ]);
    expect(result.applications[3].newDue).toMatchObject({ amount: 30, dueDate: "2026-12-08" });
    expect(result.unappliedCents).toBe(0);
  });

  it("spreads a large advance over several upcoming periods", () => {
    const result = plan(15_000, true);
    expect(result.applications.filter((item) => item.upcoming).map((item) => [item.periodStart, item.amountCents])).toEqual([
      ["2026-12-01", 3_000],
      ["2027-01-01", 3_000],
    ]);
  });

  it("never applies more than is owed unless advance is allowed, and caps how far ahead it goes", () => {
    expect(plan(10_000, false)).toMatchObject({ unappliedCents: 1_000 });
    expect(plan(10_000, false).applications.every((item) => !item.upcoming)).toBe(true);
    const huge = plan(10_000_000, true);
    expect(huge.applications.filter((item) => item.upcoming)).toHaveLength(12);
    expect(huge.unappliedCents).toBeGreaterThan(0);
  });
});

describe("balances and statuses", () => {
  const obligation = { id: uuid(1), amount: 500, due_date: "2026-11-10" };
  const pay = (amount: number, extra: Partial<LedgerPaymentRecord> = {}, n = 1): LedgerPaymentRecord => ({
    id: uuid(500 + n), user_id: USER, obligation_id: uuid(1), amount, paid_on: "2026-11-11", note: null, voided_at: null, created_at: stamp, updated_at: stamp, ...extra,
  });

  it("reports pending, overdue, partial and paid", () => {
    expect(obligationBalance({ ...obligation, due_date: "2026-11-20" }, [], "2026-11-12")).toMatchObject({ status: "pending", outstandingCents: 50_000 });
    expect(obligationBalance(obligation, [], "2026-11-12")).toMatchObject({ status: "overdue" });
    expect(obligationBalance({ ...obligation, due_date: "2026-11-20" }, [pay(200)], "2026-11-12")).toMatchObject({ status: "partial", outstandingCents: 30_000, paidCents: 20_000 });
    expect(obligationBalance(obligation, [pay(200)], "2026-11-12")).toMatchObject({ status: "overdue", partial: true });
    expect(obligationBalance(obligation, [pay(200), pay(300, {}, 2)], "2026-11-12")).toMatchObject({ status: "paid", outstandingCents: 0 });
  });

  it("ignores voided payments", () => {
    expect(obligationBalance(obligation, [pay(500, { voided_at: stamp })], "2026-11-12")).toMatchObject({ paidCents: 0, outstandingCents: 50_000 });
  });

  it("totals outstanding and collected without mixing currencies", () => {
    const person = (n: number) => ({ id: uuid(200 + n), user_id: USER, name: `P${n}`, phone: null, notes: null, archived_at: null, created_at: stamp, updated_at: stamp });
    const due = (n: number, amount: number, currency = "INR"): LedgerObligationRecord => ({
      id: uuid(n), user_id: USER, person_id: uuid(201), source: "manual", group_id: null, member_id: null, period_start: null, expense_id: null,
      title: "Loan", amount, due_date: "2026-12-01", currency, note: null, created_at: stamp, updated_at: stamp,
    });
    const rows: LedgerRows = {
      people: [person(1), person(2)], groups: [group()], members: [], rates: [], spans: [], expenses: [],
      obligations: [due(1, 500), due(2, 1000), due(3, 9999, "USD")],
      payments: [pay(200, { obligation_id: uuid(1) }), pay(100, { obligation_id: uuid(3) }, 2)],
    };
    const model = buildLedgerModel(rows, "2026-11-12", "INR");
    expect(model.overview).toMatchObject({ outstandingCents: 130_000, collectedCents: 20_000, peopleCount: 2, activeGroups: 1, otherCurrencyDues: 1 });
    expect(model.personSummaries.get(uuid(201))).toMatchObject({ outstandingCents: 130_000, collectedCents: 20_000 });
  });
});

describe("input rules", () => {
  it("requires shares to add up to the total unless an unallocated balance is allowed", () => {
    const expense = (extra: Record<string, unknown> = {}) => ({
      title: "KSEB", total_amount: 1000, expense_date: "2026-11-10", currency: "INR", allow_unallocated: false,
      shares: [{ id: uuid(1), person_id: uuid(2), amount: 300 }, { id: uuid(3), person_id: uuid(4), amount: 400 }, { id: uuid(5), person_id: uuid(6), amount: 300 }],
      ...extra,
    });
    expect(normalizeExpense(expense()).ok).toBe(true);
    const short = normalizeExpense(expense({ shares: [{ id: uuid(1), person_id: uuid(2), amount: 300 }] }));
    expect(short.ok).toBe(false);
    expect(normalizeExpense(expense({ allow_unallocated: true, shares: [{ id: uuid(1), person_id: uuid(2), amount: 300 }] })).ok).toBe(true);
    expect(normalizeExpense(expense({ shares: [{ id: uuid(1), person_id: uuid(2), amount: 1200 }] })).ok).toBe(false);
  });

  it("rejects amounts with more than two decimals and non-positive amounts", () => {
    const rejected = (amount: unknown) =>
      normalizeExpense({ title: "x", total_amount: amount, expense_date: "2026-11-10", currency: "INR", shares: [{ id: uuid(1), person_id: uuid(2), amount: 1 }] }).ok;
    expect(rejected(10.123)).toBe(false);
    expect(rejected(0)).toBe(false);
    expect(rejected(-5)).toBe(false);
  });

  it("validates a group's schedule", () => {
    const valid = { name: "Netflix", frequency: "custom_days", frequency_interval: 14, start_date: "2026-11-01", due_offset_days: 3, currency: "INR" };
    expect(normalizeGroup(valid).ok).toBe(true);
    expect(normalizeGroup({ ...valid, frequency_interval: 0 }).ok).toBe(false);
    expect(normalizeGroup({ ...valid, frequency: "daily" }).ok).toBe(false);
  });
});

describe("business rules", () => {
  const person = { id: uuid(1), user_id: USER, name: "Rahul", phone: null, notes: null, archived_at: null, created_at: stamp, updated_at: stamp };
  const due: LedgerObligationRecord = {
    id: uuid(2), user_id: USER, person_id: uuid(1), source: "manual", group_id: null, member_id: null, period_start: null, expense_id: null,
    title: "Loan", amount: 500, due_date: "2026-12-01", currency: "INR", note: null, created_at: stamp, updated_at: stamp,
  };
  const pay = (id: number, amount: number): LedgerPaymentRecord => ({ id: uuid(id), user_id: USER, obligation_id: uuid(2), amount, paid_on: "2026-11-12", note: null, voided_at: null, created_at: stamp, updated_at: stamp });
  const rows = (payments: LedgerPaymentRecord[] = []): LedgerRows => ({ people: [person], groups: [], members: [], rates: [], spans: [], expenses: [], obligations: [due], payments });
  const payment = (id: number, amount: number) => ({ entity: "ledger_payment" as const, op: "CREATE" as const, id: uuid(id), payload: {} as Record<string, unknown>, columns: { obligation_id: uuid(2), amount, voided_at: null } });

  it("allows partial payments up to the balance and refuses more", () => {
    const first = payment(10, 200);
    expect(validateLedgerChange(rows(), { entity: first.entity, op: first.op, id: first.id, payload: first.payload }, first.columns)).toBeNull();
    const second = payment(11, 300);
    expect(validateLedgerChange(rows([pay(10, 200)]), { entity: second.entity, op: second.op, id: second.id, payload: second.payload }, second.columns)).toBeNull();
    const over = payment(12, 400);
    expect(validateLedgerChange(rows([pay(10, 200)]), { entity: over.entity, op: over.op, id: over.id, payload: over.payload }, over.columns)).toMatch(/remaining balance/);
    const done = payment(13, 1);
    expect(validateLedgerChange(rows([pay(10, 200), pay(11, 300)]), { entity: done.entity, op: done.op, id: done.id, payload: done.payload }, done.columns)).toMatch(/fully paid/);
  });

  it("never lowers a due below what was paid, and keeps dues that have payments", () => {
    const lower = validateLedgerChange(rows([pay(10, 200)]), { entity: "ledger_obligation", op: "UPDATE", id: uuid(2), payload: {} }, { person_id: uuid(1), amount: 100, currency: "INR" });
    expect(lower).toMatch(/lower than what has already been paid/);
    const currencyChange = validateLedgerChange(rows([pay(10, 200)]), { entity: "ledger_obligation", op: "UPDATE", id: uuid(2), payload: {} }, { person_id: uuid(1), amount: 500, currency: "USD" });
    expect(currencyChange).toMatch(/currency/);
    expect(validateLedgerChange(rows(), { entity: "ledger_obligation", op: "UPDATE", id: uuid(2), payload: {} }, { person_id: uuid(1), amount: 500, currency: "USD" })).toBeNull();
    expect(validateLedgerChange(rows([pay(10, 200)]), { entity: "ledger_obligation", op: "DELETE", id: uuid(2), payload: {} }, null)).toMatch(/payments/);
    expect(validateLedgerChange(rows(), { entity: "ledger_obligation", op: "DELETE", id: uuid(2), payload: {} }, null)).toBeNull();
  });

  it("archives people with history instead of deleting them, and blocks duplicate names", () => {
    expect(validateLedgerChange(rows(), { entity: "ledger_person", op: "DELETE", id: uuid(1), payload: {} }, null)).toMatch(/archive/);
    expect(validateLedgerChange(rows(), { entity: "ledger_person", op: "CREATE", id: uuid(9), payload: {} }, { name: "rahul", archived_at: null })).toMatch(/already in your people/);
  });
});
