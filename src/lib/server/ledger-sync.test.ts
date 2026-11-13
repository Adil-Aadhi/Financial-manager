import { beforeEach, describe, expect, it } from "vitest";
import { runSyncBatch } from "./syncApply";
import { FakeLedgerDb } from "./fakeLedgerDb";
import type { SyncOperation } from "@/lib/sync/types";

type Row = Record<string, unknown>;
const USER = "11111111-1111-4111-8111-111111111111";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RAHUL = uuid(1);
const ASHA = uuid(2);
const GROUP = uuid(10);
const MEMBER = uuid(11);
const DUE = uuid(20);

let db: FakeLedgerDb;
let seq = 0;
const client = () => db as unknown as Parameters<typeof runSyncBatch>[0];

function op(entity: SyncOperation["entity"], entityId: string, kind: SyncOperation["op"], payload: Row, extra: Partial<SyncOperation> = {}): SyncOperation {
  return { opId: `op-${++seq}`, seq, ownerId: USER, entity, entityId, op: kind, payload, baseUpdatedAt: null, editedAt: "2026-11-12T10:00:00.000Z", ...extra };
}
const run = (...ops: SyncOperation[]) => runSyncBatch(client(), USER, ops);

const person = (name: string) => ({ name, phone: "", notes: "", archived_at: null });
const manualDue = (extra: Row = {}) => ({
  person_id: RAHUL, source: "manual", origin: "manual", title: "Personal borrowing", amount: 500, due_date: "2026-11-12", currency: "INR", note: "", ...extra,
});
const payment = (amount: number, extra: Row = {}) => ({ obligation_id: DUE, amount, paid_on: "2026-11-12", note: "", voided_at: null, ...extra });

beforeEach(async () => {
  db = new FakeLedgerDb(USER);
  const created = await run(op("ledger_person", RAHUL, "CREATE", person("Rahul")), op("ledger_person", ASHA, "CREATE", person("Asha")));
  expect(created.results.map((result) => result.status)).toEqual(["applied", "applied"]);
});

describe("ledger people sync", () => {
  it("treats a replayed create as already applied", async () => {
    const replay = await run(op("ledger_person", RAHUL, "CREATE", person("Rahul")));
    expect(replay.results[0].status).toBe("already-applied");
    expect(db.tables.ledger_people).toHaveLength(2);
  });

  it("rejects a second active person with the same name", async () => {
    const duplicate = await run(op("ledger_person", uuid(3), "CREATE", person("  rahul ")));
    expect(duplicate.results[0]).toMatchObject({ status: "rejected" });
    expect(db.tables.ledger_people).toHaveLength(2);
  });

  it("refuses to delete a person who has history, and allows archiving", async () => {
    await run(op("ledger_obligation", DUE, "CREATE", manualDue()));
    const deleted = await run(op("ledger_person", RAHUL, "DELETE", { id: RAHUL }));
    expect(deleted.results[0].status).toBe("rejected");
    const archived = await run(op("ledger_person", RAHUL, "UPDATE", { archived_at: "2026-11-12T10:00:00.000Z" }));
    expect(archived.results[0].status).toBe("applied");
    expect(db.tables.ledger_people.find((row) => row.id === RAHUL)?.archived_at).toBeTruthy();
  });

  it("rejects a batch that belongs to another user", async () => {
    const foreign = { ...op("ledger_person", uuid(4), "CREATE", person("X")), ownerId: "99999999-9999-4999-8999-999999999999" };
    expect((await run(foreign)).status).toBe("wrong-user");
  });
});

describe("ledger payments sync", () => {
  beforeEach(async () => {
    const created = await run(op("ledger_obligation", DUE, "CREATE", manualDue()));
    expect(created.results[0].status).toBe("applied");
  });

  it("applies partial payments until the due is fully paid", async () => {
    const first = await run(op("ledger_payment", uuid(30), "CREATE", payment(200)));
    const second = await run(op("ledger_payment", uuid(31), "CREATE", payment(300)));
    expect([first.results[0].status, second.results[0].status]).toEqual(["applied", "applied"]);
    expect(db.tables.ledger_payments).toHaveLength(2);
  });

  it("never creates a duplicate payment when the same change is sent twice", async () => {
    const operation = op("ledger_payment", uuid(30), "CREATE", payment(200));
    expect((await run(operation)).results[0].status).toBe("applied");
    expect((await run({ ...operation, opId: "resend" })).results[0].status).toBe("already-applied");
    expect(db.tables.ledger_payments).toHaveLength(1);
  });

  it("rejects a payment above the remaining balance and leaves nothing behind", async () => {
    await run(op("ledger_payment", uuid(30), "CREATE", payment(400)));
    const over = await run(op("ledger_payment", uuid(31), "CREATE", payment(200)));
    expect(over.results[0]).toMatchObject({ status: "rejected" });
    expect(db.tables.ledger_payments).toHaveLength(1);
  });

  it("voids a payment instead of deleting it, which frees the balance again", async () => {
    await run(op("ledger_payment", uuid(30), "CREATE", payment(500)));
    const voided = await run(op("ledger_payment", uuid(30), "UPDATE", { voided_at: "2026-11-12T11:00:00.000Z" }));
    expect(voided.results[0].status).toBe("applied");
    expect(db.tables.ledger_payments).toHaveLength(1);
    expect(db.tables.ledger_payments[0].voided_at).toBeTruthy();
    const again = await run(op("ledger_payment", uuid(31), "CREATE", payment(500)));
    expect(again.results[0].status).toBe("applied");
  });

  it("never deletes a payment", async () => {
    await run(op("ledger_payment", uuid(30), "CREATE", payment(100)));
    const removed = await run(op("ledger_payment", uuid(30), "DELETE", { id: uuid(30) }));
    expect(removed.results[0].status).toBe("rejected");
    expect(db.tables.ledger_payments).toHaveLength(1);
  });

  it("fixes a due's currency once it has payments, but allows it before", async () => {
    const before = await run(op("ledger_obligation", DUE, "UPDATE", { currency: "USD" }));
    expect(before.results[0].status).toBe("applied");
    expect(db.tables.ledger_obligations[0].currency).toBe("USD");
    await run(op("ledger_payment", uuid(30), "CREATE", payment(100)));
    const after = await run(op("ledger_obligation", DUE, "UPDATE", { currency: "INR" }));
    expect(after.results[0]).toMatchObject({ status: "rejected" });
    expect(db.tables.ledger_obligations[0].currency).toBe("USD");
  });

  it("keeps a due that has payments", async () => {
    await run(op("ledger_payment", uuid(30), "CREATE", payment(100)));
    const removed = await run(op("ledger_obligation", DUE, "DELETE", { id: DUE }));
    expect(removed.results[0].status).toBe("rejected");
    expect(db.tables.ledger_obligations).toHaveLength(1);
  });

  it("stops the batch at the first rejected change so later ones never overtake it", async () => {
    const result = await run(
      op("ledger_payment", uuid(30), "CREATE", payment(900)),
      op("ledger_payment", uuid(31), "CREATE", payment(100))
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("rejected");
  });
});

describe("recurring dues sync", () => {
  beforeEach(async () => {
    await run(
      op("ledger_group", GROUP, "CREATE", { name: "Spotify Family", description: "", frequency: "monthly", frequency_interval: 1, start_date: "2026-09-01", due_offset_days: 7, is_active: true, currency: "INR" }),
      op("ledger_member", MEMBER, "CREATE", { group_id: GROUP, person_id: RAHUL, joined_on: "2026-09-01" })
    );
  });

  const recurring = (period: string, extra: Row = {}) => ({
    person_id: RAHUL, source: "recurring", origin: "generated", group_id: GROUP, member_id: MEMBER, period_start: period, title: "Spotify Family",
    amount: 30, due_date: "2026-09-08", currency: "INR", note: "", ...extra,
  });

  it("creates each period once, however many times it is sent", async () => {
    const id = uuid(40);
    expect((await run(op("ledger_obligation", id, "CREATE", recurring("2026-09-01")))).results[0].status).toBe("applied");
    expect((await run(op("ledger_obligation", id, "CREATE", recurring("2026-09-01")))).results[0].status).toBe("already-applied");
    expect(db.tables.ledger_obligations).toHaveLength(1);
  });

  it("refuses a second due for the same member and period under a different id", async () => {
    await run(op("ledger_obligation", uuid(40), "CREATE", recurring("2026-09-01")));
    const clash = await run(op("ledger_obligation", uuid(41), "CREATE", recurring("2026-09-01")));
    expect(clash.results[0].status).toBe("rejected");
    expect(db.tables.ledger_obligations).toHaveLength(1);
  });

  it("fixes the group's currency once it has generated dues, but allows it before", async () => {
    const before = await run(op("ledger_group", GROUP, "UPDATE", { currency: "USD" }));
    expect(before.results[0].status).toBe("applied");
    await run(op("ledger_obligation", uuid(40), "CREATE", recurring("2026-09-01", { currency: "USD" })));
    const after = await run(op("ledger_group", GROUP, "UPDATE", { currency: "INR" }));
    expect(after.results[0]).toMatchObject({ status: "rejected" });
    expect(db.tables.ledger_groups[0].currency).toBe("USD");
    // Other edits are unaffected.
    expect((await run(op("ledger_group", GROUP, "UPDATE", { name: "Spotify Premium" }))).results[0].status).toBe("applied");
  });

  it("keeps earlier amounts when a later period uses a new contribution", async () => {
    await run(op("ledger_obligation", uuid(40), "CREATE", recurring("2026-09-01")));
    await run(op("ledger_obligation", uuid(41), "CREATE", recurring("2026-10-01", { amount: 45, due_date: "2026-10-08" })));
    expect(db.tables.ledger_obligations.map((row) => Number(row.amount))).toEqual([30, 45]);
  });
});

describe("deleting a group created by mistake", () => {
  const groupOp = () =>
    op("ledger_group", GROUP, "CREATE", { name: "Spotify Family", description: "", frequency: "monthly", frequency_interval: 1, start_date: "2026-09-01", due_offset_days: 7, is_active: true, currency: "INR" });
  const memberOps = () => [
    op("ledger_member", MEMBER, "CREATE", { group_id: GROUP, person_id: RAHUL, joined_on: "2026-09-01" }),
    op("ledger_rate", uuid(12), "CREATE", { member_id: MEMBER, effective_from: "2026-09-01", amount: 30 }),
    op("ledger_span", uuid(13), "CREATE", { member_id: MEMBER, from_date: "2026-09-01", to_date: null, end_reason: null }),
  ];
  const generated = (id: string, period: string) =>
    op("ledger_obligation", id, "CREATE", {
      person_id: RAHUL, source: "recurring", origin: "generated", group_id: GROUP, member_id: MEMBER, period_start: period, title: "Spotify Family",
      amount: 30, due_date: period, currency: "INR", note: "",
    });
  const removeGroup = () => op("ledger_group", GROUP, "DELETE", { id: GROUP });

  beforeEach(async () => {
    await run(groupOp(), ...memberOps());
    await run(generated(uuid(41), "2026-09-01"), generated(uuid(42), "2026-10-01"));
  });

  it("removes the group together with its members, contribution history, membership periods and generated dues", async () => {
    expect(db.tables.ledger_obligations).toHaveLength(2);
    const removed = await run(removeGroup());
    expect(removed.results[0].status).toBe("applied");
    expect(db.tables.ledger_groups).toHaveLength(0);
    expect(db.tables.ledger_members).toHaveLength(0);
    expect(db.tables.ledger_member_rates).toHaveLength(0);
    expect(db.tables.ledger_member_spans).toHaveLength(0);
    expect(db.tables.ledger_obligations).toHaveLength(0);
    // The people are reusable and stay.
    expect(db.tables.ledger_people).toHaveLength(2);
  });

  it("is safe to send twice", async () => {
    await run(removeGroup());
    expect((await run(removeGroup())).results[0].status).toBe("already-applied");
  });

  it("refuses to delete a group once any of its dues has a payment, even a voided one, and removes nothing", async () => {
    await run(op("ledger_payment", uuid(30), "CREATE", payment(10, { obligation_id: uuid(41) })));
    const refused = await run(removeGroup());
    expect(refused.results[0]).toMatchObject({ status: "rejected" });
    expect(refused.results[0].error).toMatch(/payments/);
    await run(op("ledger_payment", uuid(30), "UPDATE", { voided_at: "2026-11-12T11:00:00.000Z" }));
    expect((await run(removeGroup())).results[0].status).toBe("rejected");
    expect(db.tables.ledger_groups).toHaveLength(1);
    expect(db.tables.ledger_members).toHaveLength(1);
    expect(db.tables.ledger_obligations).toHaveLength(2);
  });

  // These two model the ORDERS the row locks allow, using hooks in the test double. They are not a
  // test of PostgreSQL's locking: that needs two real sessions (see the migration's comments).
  it("order 1: a payment that commits before the delete takes its locks makes the delete refuse", async () => {
    db.beforeGroupDeleteLock = () => {
      db.beforeGroupDeleteLock = undefined;
      void db.rpc("ledger_save_payment", {
        p_id: uuid(31), p_obligation_id: uuid(41), p_amount: 10, p_paid_on: "2026-11-12", p_note: null, p_voided: false,
        p_created_at: "2026-11-12T10:00:00.000Z", p_edited_at: "2026-11-12T10:00:00.000Z",
      });
    };
    const refused = await run(removeGroup());
    expect(refused.results[0]).toMatchObject({ status: "rejected" });
    expect(refused.results[0].error).toMatch(/payments/);
    expect(db.tables.ledger_payments).toHaveLength(1);
    expect(db.tables.ledger_groups).toHaveLength(1);
    expect(db.tables.ledger_obligations).toHaveLength(2);
  });

  it("order 2: a payment that was checked just before the delete committed is refused, leaving no orphan payment", async () => {
    db.beforePaymentGuard = () => {
      db.beforePaymentGuard = undefined;
      void db.rpc("ledger_delete_group", { p_id: GROUP });
    };
    const late = await run(op("ledger_payment", uuid(32), "CREATE", payment(10, { obligation_id: uuid(41) })));
    expect(late.results[0]).toMatchObject({ status: "rejected" });
    expect(late.results[0].error).toMatch(/no longer exists/);
    expect(db.tables.ledger_groups).toHaveLength(0);
    expect(db.tables.ledger_obligations).toHaveLength(0);
    expect(db.tables.ledger_payments).toHaveLength(0);
  });

  it("is atomic: if the delete fails part-way, nothing is deleted and a later attempt works", async () => {
    const before = structuredClone(db.tables);
    db.failGroupDeleteAfterObligations = true;
    const failed = await run(removeGroup());
    expect(failed.results[0]).toMatchObject({ status: "rejected" });
    expect(failed.results[0].error).toMatch(/nothing was deleted/);
    expect(db.tables).toEqual(before);
    db.failGroupDeleteAfterObligations = false;
    expect((await run(removeGroup())).results[0].status).toBe("applied");
    expect(db.tables.ledger_groups).toHaveLength(0);
  });

  it("deletes an empty group (no members, no dues)", async () => {
    await run(op("ledger_group", uuid(77), "CREATE", { name: "Netflix", description: "", frequency: "monthly", frequency_interval: 1, start_date: "2026-11-01", due_offset_days: 0, is_active: true, currency: "INR" }));
    expect((await run(op("ledger_group", uuid(77), "DELETE", { id: uuid(77) }))).results[0].status).toBe("applied");
    expect(db.tables.ledger_groups.map((row) => row.id)).toEqual([GROUP]);
  });
});

describe("deleting dues, by origin", () => {
  const remove = (id: string) => op("ledger_obligation", id, "DELETE", { id });
  const recurringDue = (id: string, period: string, origin: string, extra: Row = {}) =>
    op("ledger_obligation", id, "CREATE", {
      person_id: RAHUL, source: "recurring", origin, group_id: GROUP, member_id: MEMBER, period_start: period, title: "Spotify Family",
      amount: 30, due_date: period, currency: "INR", note: "", ...extra,
    });
  const FUTURE = "2099-01-01";
  const exists = (id: string) => db.tables.ledger_obligations.some((row) => row.id === id);

  beforeEach(async () => {
    await run(
      op("ledger_group", GROUP, "CREATE", { name: "Spotify Family", description: "", frequency: "monthly", frequency_interval: 1, start_date: "2026-09-01", due_offset_days: 7, is_active: true, currency: "INR" }),
      op("ledger_member", MEMBER, "CREATE", { group_id: GROUP, person_id: RAHUL, joined_on: "2026-09-01" })
    );
  });

  it("deletes a manual due without payments", async () => {
    await run(op("ledger_obligation", DUE, "CREATE", manualDue()));
    expect((await run(remove(DUE))).results[0].status).toBe("applied");
    expect(exists(DUE)).toBe(false);
  });

  it("deletes a mistaken earlier-period due without payments", async () => {
    await run(recurringDue(uuid(41), "2026-08-01", "earlier"));
    expect(db.tables.ledger_obligations[0].origin).toBe("earlier");
    expect((await run(remove(uuid(41)))).results[0].status).toBe("applied");
    expect(exists(uuid(41))).toBe(false);
  });

  it("deletes a due created in advance for a future period, while it has no payments", async () => {
    await run(recurringDue(uuid(42), FUTURE, "advance"));
    expect(db.tables.ledger_obligations[0].origin).toBe("advance");
    expect((await run(remove(uuid(42)))).results[0].status).toBe("applied");
    expect(exists(uuid(42))).toBe(false);
  });

  describe("advance dues must be for a future period", () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

    it("accepts an advance due for a future period", async () => {
      const accepted = await run(recurringDue(uuid(45), FUTURE, "advance"));
      expect(accepted.results[0].status).toBe("applied");
      expect(db.tables.ledger_obligations[0].origin).toBe("advance");
    });

    it("rejects an advance due for a period that starts today", async () => {
      const refused = await run(recurringDue(uuid(46), today, "advance"));
      expect(refused.results[0]).toMatchObject({ status: "rejected" });
      expect(refused.results[0].error).toMatch(/future/);
      expect(exists(uuid(46))).toBe(false);
    });

    it("rejects an advance due for a period that has already started", async () => {
      const refused = await run(recurringDue(uuid(47), "2026-09-15", "advance"));
      expect(refused.results[0]).toMatchObject({ status: "rejected" });
      expect(refused.results[0].error).toMatch(/future/);
      expect(exists(uuid(47))).toBe(false);
    });

    it("keeps classifying an older change that carries only the 'Paid in advance' note on a past period as advance, but never lets it be deleted", async () => {
      const queued = op("ledger_obligation", uuid(48), "CREATE", {
        person_id: RAHUL, source: "recurring", group_id: GROUP, member_id: MEMBER, period_start: "2026-09-15", title: "Spotify Family",
        amount: 30, due_date: "2026-09-22", currency: "INR", note: "Paid in advance",
      });
      expect((await run(queued)).results[0].status).toBe("applied");
      expect(db.tables.ledger_obligations[0].origin).toBe("advance");
      const refused = await run(remove(uuid(48)));
      expect(refused.results[0]).toMatchObject({ status: "rejected" });
      expect(refused.results[0].error).toMatch(/started/);
      expect(exists(uuid(48))).toBe(true);
    });
  });

  it("refuses a normal automatically generated due", async () => {
    await run(recurringDue(uuid(44), "2026-09-01", "generated"));
    const refused = await run(remove(uuid(44)));
    expect(refused.results[0]).toMatchObject({ status: "rejected" });
    expect(refused.results[0].error).toMatch(/created automatically/);
    expect(exists(uuid(44))).toBe(true);
  });

  it("refuses any due with payment history, even a voided payment, whatever its origin", async () => {
    const cases: Array<[string, string, string, Row]> = [
      ["manual", "", "manual", {}],
      ["earlier", "2026-08-01", "earlier", {}],
      ["advance", FUTURE, "advance", {}],
    ];
    let n = 0;
    for (const [label, period, origin] of cases) {
      const id = uuid(60 + n);
      await run(label === "manual" ? op("ledger_obligation", id, "CREATE", manualDue()) : recurringDue(id, period, origin));
      await run(op("ledger_payment", uuid(70 + n), "CREATE", payment(10, { obligation_id: id })));
      expect((await run(remove(id))).results[0].status).toBe("rejected");
      await run(op("ledger_payment", uuid(70 + n), "UPDATE", { voided_at: "2026-11-12T11:00:00.000Z" }));
      const afterVoid = await run(remove(id));
      expect(afterVoid.results[0]).toMatchObject({ status: "rejected" });
      expect(afterVoid.results[0].error).toMatch(/payments/);
      expect(exists(id)).toBe(true);
      n += 1;
    }
  });

  it("refuses to delete a share of a shared expense on its own", async () => {
    const shares = [{ id: uuid(81), person_id: RAHUL, amount: 600 }, { id: uuid(82), person_id: ASHA, amount: 400 }];
    await run(op("ledger_expense", uuid(80), "CREATE", { title: "KSEB bill", description: "", total_amount: 1000, expense_date: "2026-11-10", category: "", allow_unallocated: false, currency: "INR", shares }));
    expect(db.tables.ledger_obligations.every((row) => row.origin === "shared")).toBe(true);
    const refused = await run(remove(uuid(81)));
    expect(refused.results[0]).toMatchObject({ status: "rejected" });
    expect(refused.results[0].error).toMatch(/shared due/);
    expect(exists(uuid(81))).toBe(true);
  });

  it("works out the origin for a change queued by an older app version that sent none", async () => {
    await run(op("ledger_obligation", uuid(90), "CREATE", { ...recurringDue(uuid(90), "2026-08-01", "x").payload, origin: undefined }));
    await run(op("ledger_obligation", uuid(91), "CREATE", { ...recurringDue(uuid(91), "2026-09-01", "x").payload, origin: undefined }));
    expect(db.tables.ledger_obligations.map((row) => row.origin)).toEqual(["earlier", "generated"]);
  });

  describe("older queued changes that carry only a legacy note", () => {
    // What an older app version queued: no origin, and the note it used to mark the kind of due.
    const legacy = (id: string, period: string, note: string) =>
      op("ledger_obligation", id, "CREATE", {
        person_id: RAHUL, source: "recurring", group_id: GROUP, member_id: MEMBER, period_start: period, title: "Spotify Family",
        amount: 30, due_date: period, currency: "INR", note,
      });
    const originOf = (id: string) => db.tables.ledger_obligations.find((row) => row.id === id)?.origin;

    it("treats the exact note 'Earlier unpaid period' as an earlier period", async () => {
      expect((await run(legacy(uuid(100), "2026-08-01", "Earlier unpaid period"))).results[0].status).toBe("applied");
      expect(originOf(uuid(100))).toBe("earlier");
      // ...and an earlier period can still be deleted while it has no payments.
      expect((await run(remove(uuid(100)))).results[0].status).toBe("applied");
    });

    it("treats the exact note 'Paid in advance' as an advance period, even for a date that is not in the future", async () => {
      // 2026-10-01 is in the past, so by date alone this would be 'generated'. The backfill calls it 'advance'.
      expect((await run(legacy(uuid(101), "2026-10-01", "Paid in advance"))).results[0].status).toBe("applied");
      expect(originOf(uuid(101))).toBe("advance");
      // A started advance period is kept, exactly like the backfilled row.
      expect((await run(remove(uuid(101)))).results[0].status).toBe("rejected");
      // A future one is still deletable.
      expect((await run(legacy(uuid(102), FUTURE, "Paid in advance"))).results[0].status).toBe("applied");
      expect(originOf(uuid(102))).toBe("advance");
      expect((await run(remove(uuid(102)))).results[0].status).toBe("applied");
    });

    it("recognises the notes only when they match exactly, otherwise it uses the dates", async () => {
      await run(legacy(uuid(103), "2026-10-01", "paid in advance"));
      await run(legacy(uuid(104), "2026-11-01", "Earlier unpaid period."));
      await run(legacy(uuid(105), "2026-09-01", ""));
      expect([originOf(uuid(103)), originOf(uuid(104)), originOf(uuid(105))]).toEqual(["generated", "generated", "generated"]);
      // A note with surrounding spaces is trimmed before it is stored, so it still matches.
      await run(legacy(uuid(106), "2026-08-01", "  Earlier unpaid period  "));
      expect(originOf(uuid(106))).toBe("earlier");
    });

    it("still validates a derived origin against the group's start date", async () => {
      // The 'earlier' note on a period that isn't before the group started is inconsistent: refused, not silently generated.
      expect((await run(legacy(uuid(107), "2026-10-01", "Earlier unpaid period"))).results[0].status).toBe("rejected");
      expect(db.tables.ledger_obligations).toHaveLength(0);
    });

    it("checks 'before the group started' first, exactly like the backfill", async () => {
      // A period before the group started is 'earlier' even if the note says 'Paid in advance'.
      expect((await run(legacy(uuid(108), "2026-08-01", "Paid in advance"))).results[0].status).toBe("applied");
      expect(originOf(uuid(108))).toBe("earlier");
    });

    it("an explicit origin still wins over the note, and an existing due's origin can never be changed", async () => {
      await run(recurringDue(uuid(109), "2026-10-01", "generated", { note: "Paid in advance" }));
      expect(originOf(uuid(109))).toBe("generated");
      const changed = await run(op("ledger_obligation", uuid(109), "UPDATE", { origin: "earlier" }));
      expect(changed.results[0]).toMatchObject({ status: "rejected" });
      expect(originOf(uuid(109))).toBe("generated");
      // Editing other fields of an older due without sending an origin keeps its origin.
      const edited = await run(op("ledger_obligation", uuid(109), "UPDATE", { amount: 25 }));
      expect(edited.results[0].status).toBe("applied");
      expect(originOf(uuid(109))).toBe("generated");
    });
  });

  it("rejects an origin that doesn't fit the due", async () => {
    expect((await run(recurringDue(uuid(92), "2026-10-01", "manual"))).results[0].status).toBe("rejected");
    expect((await run(op("ledger_obligation", uuid(93), "CREATE", manualDue({ origin: "generated" })))).results[0].status).toBe("rejected");
    expect((await run(recurringDue(uuid(94), "2026-10-01", "earlier"))).results[0].status).toBe("rejected"); // not before the group starts
    expect(db.tables.ledger_obligations).toHaveLength(0);
  });
});

describe("shared expense sync", () => {
  const EXPENSE = uuid(50);
  const shares = [
    { id: uuid(51), person_id: RAHUL, amount: 600 },
    { id: uuid(52), person_id: ASHA, amount: 400 },
  ];
  const expense = (extra: Row = {}) => ({
    title: "KSEB bill", description: "", total_amount: 1000, expense_date: "2026-11-10", category: "Electricity",
    allow_unallocated: false, currency: "INR", shares, ...extra,
  });

  it("saves the expense and one due per person together", async () => {
    const saved = await run(op("ledger_expense", EXPENSE, "CREATE", expense()));
    expect(saved.results[0].status).toBe("applied");
    expect(db.tables.ledger_obligations.filter((row) => row.expense_id === EXPENSE).map((row) => Number(row.amount))).toEqual([600, 400]);
  });

  it("fixes the expense currency once any share has a payment, but allows it before", async () => {
    await run(op("ledger_expense", EXPENSE, "CREATE", expense()));
    const before = await run(op("ledger_expense", EXPENSE, "UPDATE", expense({ currency: "USD" })));
    expect(before.results[0].status).toBe("applied");
    await run(op("ledger_payment", uuid(60), "CREATE", payment(100, { obligation_id: uuid(51) })));
    const after = await run(op("ledger_expense", EXPENSE, "UPDATE", expense({ currency: "INR" })));
    expect(after.results[0]).toMatchObject({ status: "rejected" });
    expect(db.tables.ledger_expenses[0].currency).toBe("USD");
  });

  it("rejects shares that do not add up to the total unless an unallocated balance is allowed", async () => {
    const short = await run(op("ledger_expense", EXPENSE, "CREATE", expense({ shares: [{ id: uuid(51), person_id: RAHUL, amount: 600 }] })));
    expect(short.results[0].status).toBe("rejected");
    expect(db.tables.ledger_expenses).toHaveLength(0);
    const allowed = await run(op("ledger_expense", EXPENSE, "CREATE", expense({ allow_unallocated: true, shares: [{ id: uuid(51), person_id: RAHUL, amount: 600 }] })));
    expect(allowed.results[0].status).toBe("applied");
  });

  it("edits an expense while keeping its payment history, and refuses to drop a person who paid", async () => {
    await run(op("ledger_expense", EXPENSE, "CREATE", expense()));
    await run(op("ledger_payment", uuid(60), "CREATE", payment(200, { obligation_id: uuid(51) })));
    const edited = await run(op("ledger_expense", EXPENSE, "UPDATE", expense({ title: "KSEB Oct", description: "Updated" })));
    expect(edited.results[0].status).toBe("applied");
    expect(db.tables.ledger_payments).toHaveLength(1);
    // Asha has not paid, so she can be removed; Rahul has, so he can't.
    const dropped = await run(op("ledger_expense", EXPENSE, "UPDATE", expense({ total_amount: 600, shares: [shares[0]] })));
    expect(dropped.results[0].status).toBe("applied");
    const dropPaid = await run(op("ledger_expense", EXPENSE, "UPDATE", expense({ total_amount: 400, shares: [shares[1]] })));
    expect(dropPaid.results[0].status).toBe("rejected");
  });
});
