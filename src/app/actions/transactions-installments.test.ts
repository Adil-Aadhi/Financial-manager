import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeInstallmentsDb } from "@/lib/server/fakeInstallmentsDb";

const USER = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "44444444-4444-4444-8444-444444444444";
const CATEGORY = "66666666-6666-4666-8666-666666666666";
const GENERATED = "00000000-0000-4000-8000-000000000201";
const LINKED = "00000000-0000-4000-8000-000000000202";
const REGULAR = "00000000-0000-4000-8000-000000000203";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    Object.assign(holder.db as object, {
      auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
    }),
}));

const { deleteTransactionAction, updateTransactionAction } = await import("@/app/actions/transactions");

let db: FakeInstallmentsDb;
const tx = (id: string, amount = 5_000) => ({
  id, user_id: USER, account_id: ACCOUNT, category_id: CATEGORY, type: "expense", amount,
  description: "x", transaction_date: "2026-01-05", transaction_time: null,
});
const edit = (transactionId: string) => ({
  transactionId, type: "expense" as const, amount: 1, accountId: ACCOUNT, categoryId: CATEGORY,
  transactionDate: "2026-01-06", transactionTime: "", remark: "changed",
});

beforeEach(() => {
  db = new FakeInstallmentsDb(USER);
  holder.db = db;
  db.tables.accounts.push({ id: ACCOUNT, user_id: USER, deleted_at: null });
  db.tables.categories.push({ id: CATEGORY, user_id: null, name: "Installment Payment", type: "expense", is_default: true });
  db.tables.transactions.push(tx(GENERATED), tx(LINKED), tx(REGULAR, 300));
  db.tables.installment_payments.push(
    { id: "p1", user_id: USER, transaction_id: GENERATED, transaction_origin: "created" },
    { id: "p2", user_id: USER, transaction_id: LINKED, transaction_origin: "linked" }
  );
});

describe("Transactions server actions and installment-generated expenses", () => {
  it("refuses to edit a generated expense even when the action is called directly", async () => {
    const result = await updateTransactionAction(edit(GENERATED));
    expect(result).toEqual({ success: false, error: expect.stringMatching(/managed by Installments/) });
    expect(db.tables.transactions.find((row) => row.id === GENERATED)).toMatchObject({ amount: 5_000, description: "x" });
  });

  it("refuses to delete a generated expense even when the action is called directly", async () => {
    const result = await deleteTransactionAction(GENERATED);
    expect(result).toEqual({ success: false, error: expect.stringMatching(/managed by Installments/) });
    expect(db.tables.transactions.some((row) => row.id === GENERATED)).toBe(true);
  });

  it("keeps regular and manually linked transactions editable and deletable", async () => {
    expect(await updateTransactionAction(edit(REGULAR))).toEqual({ success: true });
    expect(db.tables.transactions.find((row) => row.id === REGULAR)).toMatchObject({ amount: 1, description: "changed" });
    expect(await updateTransactionAction(edit(LINKED))).toEqual({ success: true });
    expect(await deleteTransactionAction(REGULAR)).toEqual({ success: true });
    expect(await deleteTransactionAction(LINKED)).toEqual({ success: true });
    expect(db.tables.transactions.map((row) => row.id)).toEqual([GENERATED]);
  });
});
