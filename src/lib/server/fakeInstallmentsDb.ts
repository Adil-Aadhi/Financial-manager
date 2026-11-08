import {
  closureExpectedCents,
  expectedInstallmentAmount,
  installmentDueDate,
  installmentTransactionDescription,
} from "@/lib/installments";

/**
 * In-memory stand-in for the Supabase client: enough of the query builder for the sync apply,
 * plus JavaScript versions of save_installment_payment / delete_installment_payment that follow
 * the migration's SQL (one atomic write of payment + created expense). The SQL itself is not
 * executed here (the real SQL is exercised separately against Postgres).
 */
type Row = Record<string, unknown>;

export class FakeInstallmentsDb {
  constructor(public userId: string) {}

  tables: Record<string, Row[]> = {
    installment_plans: [],
    installment_payments: [],
    transactions: [],
    accounts: [],
    categories: [],
  };
  rpcCalls: Array<{ name: string; args: Row }> = [];

  from(table: string) {
    return new Query(this, table);
  }

  async rpc(name: string, rpcArgs: Row) {
    let args = rpcArgs;
    this.rpcCalls.push({ name, args });
    const payments = this.tables.installment_payments;
    const transactions = this.tables.transactions;
    if (name === "delete_installment_payment") {
      const index = payments.findIndex((row) => row.id === args.p_id);
      if (index < 0) return { data: null, error: null };
      const [removed] = payments.splice(index, 1);
      if (removed.transaction_origin === "created") this.tables.transactions = transactions.filter((row) => row.id !== removed.transaction_id);
      return { data: null, error: null };
    }
    const old = payments.find((row) => row.id === args.p_id);
    // A linked transaction is the source of truth for its payment's amount, date and account.
    if (args.p_transaction_origin === "linked") {
      const linked = transactions.find((row) => row.id === args.p_transaction_id && row.user_id === this.userId);
      if (linked && linked.type === "expense") {
        const sameLink = old?.transaction_origin === "linked" && old.transaction_id === args.p_transaction_id;
        if (sameLink) args = { ...args, p_actual_amount: linked.amount, p_account_id: linked.account_id };
        args = { ...args, p_payment_date: linked.transaction_date };
      }
    }
    const plan = this.tables.installment_plans.find((row) => row.id === args.p_plan_id)!;
    const count = Number(plan.installment_count);
    const number = Number(args.p_installment_number);
    const covers = args.p_kind === "closure" ? count : number;
    const others = payments.filter((row) => row.installment_plan_id === args.p_plan_id && row.id !== args.p_id);
    if (others.some((row) => Number(row.installment_number) <= covers && Number(row.covers_through) >= number)) {
      return { data: null, error: { code: "P0001", message: `Installment ${number} already has a payment or was settled by the early closure.` } };
    }
    const expected =
      args.p_kind === "closure"
        ? closureExpectedCents(plan as never, others as never) / 100
        : expectedInstallmentAmount(plan as never, number);
    const category = this.tables.categories.find((row) => row.is_default && row.type === "expense" && row.name === "Installment Payment");
    const description = installmentTransactionDescription(String(plan.name), number, count, args.p_kind as never, covers);
    const drop =
      old?.transaction_origin === "created" && old.transaction_id && (args.p_transaction_origin !== "created" || args.p_transaction_id !== old.transaction_id)
        ? old.transaction_id
        : null;
    if (args.p_transaction_origin === "created") {
      const existing = transactions.find((row) => row.id === args.p_transaction_id);
      if (!category) return { data: null, error: { code: "P0001", message: "The Installment Payment category is missing." } };
      const values = { account_id: args.p_account_id, category_id: category.id, type: "expense", amount: args.p_actual_amount, description, transaction_date: args.p_payment_date, user_id: this.userId };
      if (existing) Object.assign(existing, values);
      else transactions.push({ id: args.p_transaction_id, ...values });
    }
    const values = {
      id: args.p_id, user_id: this.userId, installment_plan_id: args.p_plan_id, installment_number: args.p_installment_number, kind: args.p_kind,
      covers_through: covers, due_date: installmentDueDate(plan as never, number), expected_amount: expected, actual_amount: args.p_actual_amount,
      payment_date: args.p_payment_date, payment_method: args.p_payment_method, account_id: args.p_account_id, transaction_id: args.p_transaction_id,
      transaction_origin: args.p_transaction_origin, notes: args.p_notes, paid_at: args.p_paid_at ?? args.p_edited_at, updated_at: args.p_edited_at,
    };
    if (old) Object.assign(old, values);
    else payments.push(values);
    if (drop) this.tables.transactions = this.tables.transactions.filter((row) => row.id !== drop);
    return { data: null, error: null };
  }
}

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private action: "select" | "insert" | "update" | "delete" = "select";
  private values: Row = {};
  constructor(private db: FakeInstallmentsDb, private table: string) {}
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  is(column: string, value: unknown) { this.filters.push((row) => (row[column] ?? null) === value); return this; }
  ilike(column: string, value: string) { this.filters.push((row) => String(row[column]).toLowerCase() === value.toLowerCase()); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  or() { return this; }
  order() { return this; }
  range() { return this; }
  limit() { return this; }
  insert(values: Row) { this.action = "insert"; this.values = values; return this; }
  update(values: Row) { this.action = "update"; this.values = values; return this; }
  delete() { this.action = "delete"; return this; }
  private run() {
    const rows = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    if (this.action === "insert") {
      if (rows.some((row) => row.id === this.values.id)) return { data: null, error: { code: "23505", message: "duplicate" } };
      rows.push({ ...this.values });
      return { data: null, error: null };
    }
    const matched = rows.filter((row) => this.filters.every((filter) => filter(row)));
    // Mirrors the protect_installment_transactions trigger: direct writes to an installment-generated
    // expense are refused. The payment functions (rpc above) change those rows themselves.
    if (this.table === "transactions" && (this.action === "update" || this.action === "delete")) {
      const managed = matched.some((row) =>
        this.db.tables.installment_payments.some((payment) => payment.transaction_id === row.id && payment.transaction_origin === "created")
      );
      if (managed) return { data: null, error: { code: "P0001", message: "This expense is managed by Installments. Edit or undo the payment from the Installments page." } };
    }
    if (this.action === "update") matched.forEach((row) => Object.assign(row, this.values));
    if (this.action === "delete") this.db.tables[this.table] = rows.filter((row) => !matched.includes(row));
    // Mirrors sync_linked_installment_payment: a linked payment follows its transaction.
    if (this.table === "transactions" && (this.action === "update" || this.action === "delete")) {
      for (const row of matched) {
        for (const payment of this.db.tables.installment_payments) {
          if (payment.transaction_id !== row.id || payment.transaction_origin !== "linked") continue;
          if (this.action === "delete" || row.type !== "expense") {
            payment.transaction_id = null;
            payment.account_id = null;
          } else {
            Object.assign(payment, { actual_amount: row.amount, payment_date: row.transaction_date, account_id: row.account_id });
          }
        }
      }
    }
    return { data: matched.map((row) => ({ ...row })), error: null };
  }
  async maybeSingle() {
    const result = this.run();
    return { data: result.data?.[0] ?? null, error: result.error };
  }
  then<T>(resolve: (value: { data: Row[] | null; error: unknown }) => T) {
    return Promise.resolve(this.run()).then(resolve);
  }
}


