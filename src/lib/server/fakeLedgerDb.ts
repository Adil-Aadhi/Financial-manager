import { toCents } from "@/lib/dailyBudget";

/**
 * In-memory stand-in for the Supabase client: the query builder the ledger sync apply needs, plus
 * JavaScript versions of the ledger write functions that follow the migration's SQL (payment guard,
 * unique (member, period), shares). The SQL itself is not executed here.
 */
type Row = Record<string, unknown>;
type RpcResult = { data: null; error: { code: string; message: string } | null };

/** Today's date in India, the calendar the app and the database use for "has this period started". */
const indiaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

const ok: RpcResult = { data: null, error: null };
const refuse = (message: string): RpcResult => ({ data: null, error: { code: "P0001", message } });

export class FakeLedgerDb {
  constructor(public userId: string) {}

  tables: Record<string, Row[]> = {
    ledger_people: [],
    ledger_groups: [],
    ledger_members: [],
    ledger_member_rates: [],
    ledger_member_spans: [],
    ledger_expenses: [],
    ledger_obligations: [],
    ledger_payments: [],
  };
  rpcCalls: Array<{ name: string; args: Row }> = [];

  /*
   * Interleaving hooks for ORDERING tests. They run another change "in the window" where a real
   * database would have it commit first. They model the two orders the row locks allow; they are
   * not a test of PostgreSQL's locking itself.
   */
  /** Runs just before ledger_delete_group takes its locks: a payment that committed first. */
  beforeGroupDeleteLock?: () => void;
  /** Runs after ledger_save_payment's existence check and before its guard re-checks the due. */
  beforePaymentGuard?: () => void;
  /** Makes ledger_delete_group fail after removing the dues, to check it rolls back as a whole. */
  failGroupDeleteAfterObligations = false;

  from(table: string) {
    return new Query(this, table);
  }

  private paid(obligationId: unknown, exclude?: unknown) {
    return this.tables.ledger_payments
      .filter((row) => row.obligation_id === obligationId && !row.voided_at && row.id !== exclude)
      .reduce((sum, row) => sum + toCents(row.amount as number), 0);
  }

  async rpc(name: string, args: Row): Promise<RpcResult> {
    this.rpcCalls.push({ name, args });
    const obligations = this.tables.ledger_obligations;
    const payments = this.tables.ledger_payments;

    if (name === "ledger_save_payment") {
      if (!obligations.find((row) => row.id === args.p_obligation_id)) return refuse("This due no longer exists.");
      this.beforePaymentGuard?.();
      // The payment guard locks and re-reads the due; if it vanished meanwhile the payment is refused.
      const obligation = this.tables.ledger_obligations.find((row) => row.id === args.p_obligation_id);
      if (!obligation) return refuse("This due no longer exists.");
      const old = payments.find((row) => row.id === args.p_id);
      const voided = args.p_voided === true;
      if (!voided && this.paid(obligation.id, args.p_id) + toCents(args.p_amount as number) > toCents(obligation.amount as number)) {
        return refuse("This payment is more than the remaining balance.");
      }
      const values = {
        id: args.p_id,
        user_id: this.userId,
        obligation_id: args.p_obligation_id,
        amount: args.p_amount,
        paid_on: args.p_paid_on,
        note: args.p_note,
        voided_at: voided ? (old?.voided_at ?? args.p_edited_at) : null,
        updated_at: args.p_edited_at,
      };
      if (old) Object.assign(old, values);
      else payments.push({ ...values, created_at: args.p_created_at });
      return ok;
    }

    if (name === "ledger_save_obligation") {
      const old = obligations.find((row) => row.id === args.p_id);
      // Mirrors the origin rules of the SQL function: inferred when not given, then validated.
      const groupStart = this.tables.ledger_groups.find((group) => group.id === args.p_group_id)?.start_date as string | undefined;
      const period = args.p_period_start as string | null;
      // Same order as the SQL (and its backfill): the exact legacy notes count as well as the dates.
      const note = typeof args.p_note === "string" ? args.p_note.trim() : "";
      const inferred =
        args.p_source === "manual"
          ? "manual"
          : (groupStart && period && period < groupStart) || note === "Earlier unpaid period"
            ? "earlier"
            : note === "Paid in advance" || (period && period > indiaToday())
              ? "advance"
              : "generated";
      const origin = (args.p_origin as string | null) ?? (old?.origin as string | undefined) ?? inferred;
      if ((args.p_source === "manual") !== (origin === "manual")) return refuse("A due's type doesn't match its origin.");
      if (args.p_source === "recurring" && groupStart && period) {
        if (origin === "earlier" ? period >= groupStart : period < groupStart) return refuse("This period doesn't match the due's origin.");
      }
      if (old && old.origin && args.p_origin && old.origin !== args.p_origin) return refuse("A due's origin can't change.");
      // An advance origin the caller states must be a genuinely future period (India calendar).
      if (!old && origin === "advance" && args.p_origin && period && period <= indiaToday()) {
        return refuse("An advance due must be for a period in the future.");
      }
      if (old) {
        if (toCents(args.p_amount as number) < this.paid(old.id)) return refuse("This amount is less than the amount already paid.");
        if (old.currency !== args.p_currency && payments.some((row) => row.obligation_id === old.id)) {
          return refuse("This due already has payments, so its currency can't change.");
        }
        Object.assign(old, { title: args.p_title, amount: args.p_amount, due_date: args.p_due_date, currency: args.p_currency, note: args.p_note, updated_at: args.p_edited_at });
        return ok;
      }
      if (args.p_source === "recurring" && obligations.some((row) => row.member_id === args.p_member_id && row.period_start === args.p_period_start)) {
        return refuse("This period already has a due.");
      }
      obligations.push({
        id: args.p_id,
        user_id: this.userId,
        person_id: args.p_person_id,
        source: args.p_source,
        origin,
        group_id: args.p_group_id,
        member_id: args.p_member_id,
        period_start: args.p_period_start,
        expense_id: null,
        title: args.p_title,
        amount: args.p_amount,
        due_date: args.p_due_date,
        currency: args.p_currency,
        note: args.p_note,
        created_at: args.p_created_at,
        updated_at: args.p_edited_at,
      });
      return ok;
    }

    if (name === "ledger_delete_group") {
      const group = this.tables.ledger_groups.find((row) => row.id === args.p_id);
      if (!group) return ok;
      this.beforeGroupDeleteLock?.();
      // Everything below reads the tables fresh, as the SQL's later statements do.
      const dueIds = new Set(this.tables.ledger_obligations.filter((row) => row.group_id === args.p_id).map((row) => row.id));
      if (this.tables.ledger_payments.some((payment) => dueIds.has(payment.obligation_id))) {
        return refuse("This group has payments, so it is kept for the history. Deactivate it instead.");
      }
      // One transaction: if a step fails, every table goes back to how it was.
      const snapshot = structuredClone(this.tables);
      this.tables.ledger_obligations = this.tables.ledger_obligations.filter((row) => row.group_id !== args.p_id);
      if (this.failGroupDeleteAfterObligations) {
        this.tables = snapshot;
        return { data: null, error: { code: "23503", message: "update or delete violates foreign key constraint" } };
      }
      const memberIds = new Set(this.tables.ledger_members.filter((row) => row.group_id === args.p_id).map((row) => row.id));
      this.tables.ledger_member_rates = this.tables.ledger_member_rates.filter((row) => !memberIds.has(row.member_id));
      this.tables.ledger_member_spans = this.tables.ledger_member_spans.filter((row) => !memberIds.has(row.member_id));
      this.tables.ledger_members = this.tables.ledger_members.filter((row) => row.group_id !== args.p_id);
      this.tables.ledger_groups = this.tables.ledger_groups.filter((row) => row.id !== args.p_id);
      return ok;
    }

    if (name === "ledger_delete_obligation") {
      const old = obligations.find((row) => row.id === args.p_id);
      if (!old) return ok;
      // Mirrors ledger_delete_obligation, in the same order.
      if (old.origin === "shared") return refuse("A shared due is removed by editing its expense.");
      if (payments.some((row) => row.obligation_id === args.p_id)) return refuse("This due has payments, so it is kept for the history.");
      if (old.origin === "generated") return refuse("This period is created automatically, so it can't be deleted.");
      if (old.origin === "advance" && (old.period_start as string) <= indiaToday()) return refuse("This period has started and is now generated automatically.");
      this.tables.ledger_obligations = obligations.filter((row) => row.id !== args.p_id);
      return ok;
    }

    if (name === "ledger_save_expense") {
      const shares = args.p_shares as Array<{ id: string; person_id: string; amount: number }>;
      const total = toCents(args.p_total as number);
      const sum = shares.reduce((acc, share) => acc + toCents(share.amount), 0);
      if (sum > total) return refuse("The shares add up to more than the total.");
      if (sum < total && !args.p_allow_unallocated) return refuse("The shares are short of the total.");
      const keep = new Set(shares.map((share) => share.id));
      const gone = obligations.filter((row) => row.expense_id === args.p_id && !keep.has(row.id as string));
      if (gone.some((row) => payments.some((payment) => payment.obligation_id === row.id))) {
        return refuse("A person with payments can't be removed from this expense.");
      }
      const expenses = this.tables.ledger_expenses;
      const old = expenses.find((row) => row.id === args.p_id);
      if (
        old && old.currency !== args.p_currency &&
        obligations.some((row) => row.expense_id === args.p_id && payments.some((payment) => payment.obligation_id === row.id))
      ) {
        return refuse("This expense already has payments, so its currency can't change.");
      }
      const values = {
        id: args.p_id,
        user_id: this.userId,
        title: args.p_title,
        description: args.p_description,
        total_amount: args.p_total,
        expense_date: args.p_date,
        category: args.p_category,
        allow_unallocated: args.p_allow_unallocated,
        currency: args.p_currency,
        updated_at: args.p_edited_at,
      };
      if (old) Object.assign(old, values);
      else expenses.push({ ...values, created_at: args.p_created_at });
      this.tables.ledger_obligations = obligations.filter((row) => !gone.includes(row));
      for (const share of shares) {
        const existing = this.tables.ledger_obligations.find((row) => row.id === share.id);
        if (existing && toCents(share.amount) < this.paid(existing.id)) return refuse("This amount is less than the amount already paid.");
        const next = {
          id: share.id,
          user_id: this.userId,
          person_id: share.person_id,
          source: "shared",
          origin: "shared",
          group_id: null,
          member_id: null,
          period_start: null,
          expense_id: args.p_id,
          title: args.p_title,
          amount: share.amount,
          due_date: args.p_date,
          currency: args.p_currency,
          note: null,
          updated_at: args.p_edited_at,
        };
        if (existing) Object.assign(existing, next);
        else this.tables.ledger_obligations.push({ ...next, created_at: args.p_created_at });
      }
      return ok;
    }

    if (name === "ledger_delete_expense") {
      const shares = obligations.filter((row) => row.expense_id === args.p_id);
      if (shares.some((row) => payments.some((payment) => payment.obligation_id === row.id))) {
        return refuse("This expense has payments, so it is kept for the history.");
      }
      this.tables.ledger_obligations = obligations.filter((row) => row.expense_id !== args.p_id);
      this.tables.ledger_expenses = this.tables.ledger_expenses.filter((row) => row.id !== args.p_id);
      return ok;
    }

    return { data: null, error: { code: "42883", message: `unknown function ${name}` } };
  }
}

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private action: "select" | "insert" | "update" | "delete" = "select";
  private values: Row = {};
  constructor(private db: FakeLedgerDb, private table: string) {}
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  order() { return this; }
  range() { return this; }
  insert(values: Row) { this.action = "insert"; this.values = values; return this; }
  update(values: Row) { this.action = "update"; this.values = values; return this; }
  delete() { this.action = "delete"; return this; }
  private run() {
    const rows = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    if (this.action === "insert") {
      if (rows.some((row) => row.id === this.values.id)) return { data: null, error: { code: "23505", message: "duplicate" } };
      // Mirrors the active-name unique index on people.
      if (this.table === "ledger_people" && !this.values.archived_at) {
        const name = String(this.values.name).trim().toLowerCase();
        if (rows.some((row) => !row.archived_at && String(row.name).trim().toLowerCase() === name)) {
          return { data: null, error: { code: "23505", message: "duplicate name" } };
        }
      }
      rows.push({ ...this.values });
      return { data: null, error: null };
    }
    const matched = rows.filter((row) => this.filters.every((filter) => filter(row)));
    // Mirrors ledger_group_guard: a group's currency is fixed once it has dues.
    if (this.table === "ledger_groups" && this.action === "update" && this.values.currency !== undefined) {
      const locked = matched.some(
        (group) => group.currency !== this.values.currency && this.db.tables.ledger_obligations.some((row) => row.group_id === group.id)
      );
      if (locked) return { data: null, error: { code: "P0001", message: "This group already has dues, so its currency can't change." } };
    }
    if (this.action === "update") matched.forEach((row) => Object.assign(row, this.values));
    if (this.action === "delete") {
      if (this.table === "ledger_people" && matched.some((person) => this.db.tables.ledger_obligations.some((row) => row.person_id === person.id))) {
        return { data: null, error: { code: "23503", message: "restrict" } };
      }
      this.db.tables[this.table] = rows.filter((row) => !matched.includes(row));
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
