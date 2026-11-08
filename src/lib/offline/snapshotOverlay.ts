import type {
  LocalAccount,
  LocalCategory,
  LocalDailyBudgetExpense,
  LocalDailyBudgetLimit,
  LocalMonthlyBudget,
  LocalTransaction,
  LocalSubscription,
  LocalSubscriptionPayment,
  LocalBill,
  LocalBillPayment,
  LocalInstallmentPayment,
  LocalInstallmentPlan,
  OutboxEntry,
} from "./db";
import { isAmbiguousLegacyTransactionDateUpdate, normalizeTransactionDate } from "@/lib/transactions";

export interface LocalSnapshotRows {
  accounts: LocalAccount[];
  categories: LocalCategory[];
  transactions: LocalTransaction[];
  budget: LocalMonthlyBudget | null;
  /** Daily Budget Tracker rows. Optional so callers written before the feature still work. */
  dailyLimits?: LocalDailyBudgetLimit[];
  dailyExpenses?: LocalDailyBudgetExpense[];
  subscriptions?: LocalSubscription[];
  subscriptionPayments?: LocalSubscriptionPayment[];
  bills?: LocalBill[];
  billPayments?: LocalBillPayment[];
  installmentPlans?: LocalInstallmentPlan[];
  installmentPayments?: LocalInstallmentPayment[];
}

/**
 * Keys an installment_payment operation carries for the device only (never stored on the payment
 * row): the expense transaction it writes, the one it stops using, and the plan's new lifecycle.
 */
export const INSTALLMENT_PAYMENT_LOCAL_KEYS = ["transaction_row", "previous_transaction_id", "plan_lifecycle", "transaction_time"] as const;

export function installmentPaymentRow(payload: Record<string, unknown>) {
  const row: Record<string, unknown> = { ...payload };
  for (const key of INSTALLMENT_PAYMENT_LOCAL_KEYS) delete row[key];
  return row;
}

function byId<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

/** Replays durable local intent over a complete server snapshot without creating new outbox rows. */
export function overlayOutbox(
  ownerId: string,
  server: LocalSnapshotRows,
  previous: LocalSnapshotRows,
  entries: OutboxEntry[]
): LocalSnapshotRows {
  const accounts = byId(server.accounts);
  const previousAccounts = byId(previous.accounts);
  const categories = byId(server.categories);
  const previousCategories = byId(previous.categories);
  const transactions = byId(server.transactions);
  const previousTransactions = byId(previous.transactions);
  let budget = server.budget;
  const dailyLimits = new Map((server.dailyLimits ?? []).map((row) => [row.effective_date, row]));
  const previousDailyLimits = new Map(
    (previous.dailyLimits ?? []).map((row) => [row.effective_date, row])
  );
  const dailyExpenses = byId(server.dailyExpenses ?? []);
  const previousDailyExpenses = byId(previous.dailyExpenses ?? []);
  const subscriptions = byId(server.subscriptions ?? []);
  const previousSubscriptions = byId(previous.subscriptions ?? []);
  const subscriptionPayments = byId(server.subscriptionPayments ?? []);
  const previousSubscriptionPayments = byId(previous.subscriptionPayments ?? []);
  const bills = byId(server.bills ?? []);
  const previousBills = byId(previous.bills ?? []);
  const billPayments = byId(server.billPayments ?? []);
  const previousBillPayments = byId(previous.billPayments ?? []);
  const installmentPlans = byId(server.installmentPlans ?? []);
  const previousInstallmentPlans = byId(previous.installmentPlans ?? []);
  const installmentPayments = byId(server.installmentPayments ?? []);
  const previousInstallmentPayments = byId(previous.installmentPayments ?? []);

  // Pending Transactions edits of a manually linked transaction carry over to its payment, exactly
  // like the server's sync_linked_installment_payment trigger will once they sync.
  const followLinkedTransaction = (transactionId: string, next: LocalTransaction | null) => {
    for (const [id, payment] of installmentPayments) {
      if (payment.transaction_id !== transactionId || payment.transaction_origin !== "linked") continue;
      if (!next || next.type !== "expense") {
        installmentPayments.set(id, { ...payment, transaction_id: null, account_id: null });
      } else {
        installmentPayments.set(id, {
          ...payment,
          actual_amount: Number(next.amount),
          payment_date: normalizeTransactionDate(next.transaction_date) ?? payment.payment_date,
          account_id: next.account_id,
        });
      }
    }
  };

  for (const entry of [...entries].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0))) {
    if (entry.ownerId !== ownerId) continue;

    if (entry.entity === "account") {
      if (entry.op === "DELETE") {
        accounts.delete(entry.entityId);
        continue;
      }
      const base = accounts.get(entry.entityId) ?? previousAccounts.get(entry.entityId);
      if (base || entry.op === "CREATE") {
        accounts.set(entry.entityId, {
          ...(base ?? ({} as LocalAccount)),
          ...entry.payload,
          ownerId,
          id: entry.entityId,
          user_id: ownerId,
        } as LocalAccount);
      }
      continue;
    }

    if (entry.entity === "category") {
      if (entry.op === "DELETE") {
        categories.delete(entry.entityId);
        continue;
      }
      const base = categories.get(entry.entityId) ?? previousCategories.get(entry.entityId);
      if (base || entry.op === "CREATE") {
        categories.set(entry.entityId, {
          ...(base ?? ({} as LocalCategory)),
          ...entry.payload,
          ownerId,
          id: entry.entityId,
          user_id: ownerId,
        } as LocalCategory);
      }
      continue;
    }

    if (entry.entity === "transaction") {
      if (entry.op === "DELETE") {
        transactions.delete(entry.entityId);
        followLinkedTransaction(entry.entityId, null);
        continue;
      }
      const base =
        transactions.get(entry.entityId) ?? previousTransactions.get(entry.entityId);
      if (base || entry.op === "CREATE") {
        const payload = { ...entry.payload };
        if (
          entry.op === "UPDATE" &&
          (entry.transactionDateIntent === "unchanged" ||
            (entry.transactionDateIntent === undefined &&
              isAmbiguousLegacyTransactionDateUpdate(
                base?.transaction_date,
                payload.transaction_date
              )))
        ) {
          delete payload.transaction_date;
        }
        const next = {
          ...(base ?? ({} as LocalTransaction)),
          ...payload,
          ownerId,
          id: entry.entityId,
          user_id: ownerId,
        } as LocalTransaction;
        transactions.set(entry.entityId, next);
        followLinkedTransaction(entry.entityId, next);
      }
      continue;
    }

    if (entry.entity === "daily_expense") {
      if (entry.op === "DELETE") {
        dailyExpenses.delete(entry.entityId);
        continue;
      }
      const base = dailyExpenses.get(entry.entityId) ?? previousDailyExpenses.get(entry.entityId);
      if (base || entry.op === "CREATE") {
        dailyExpenses.set(entry.entityId, {
          ...(base ?? ({} as LocalDailyBudgetExpense)),
          ...entry.payload,
          ownerId,
          id: entry.entityId,
          user_id: ownerId,
        } as LocalDailyBudgetExpense);
      }
      continue;
    }

    if (entry.entity === "daily_limit") {
      // Keyed by effective date: CREATE and UPDATE both set that day's limit.
      if (entry.op === "DELETE") {
        dailyLimits.delete(entry.entityId);
        continue;
      }
      const base = dailyLimits.get(entry.entityId) ?? previousDailyLimits.get(entry.entityId);
      dailyLimits.set(entry.entityId, {
        ...(base ?? ({} as LocalDailyBudgetLimit)),
        ...entry.payload,
        ownerId,
        effective_date: entry.entityId,
        user_id: ownerId,
      } as LocalDailyBudgetLimit);
      continue;
    }

    if (entry.entity === "subscription") {
      if (entry.op === "DELETE") {
        subscriptions.delete(entry.entityId);
        for (const [id, payment] of subscriptionPayments) {
          if (payment.subscription_id === entry.entityId) subscriptionPayments.delete(id);
        }
        continue;
      }
      const base = subscriptions.get(entry.entityId) ?? previousSubscriptions.get(entry.entityId);
      if (base || entry.op === "CREATE") {
        subscriptions.set(entry.entityId, {
          ...(base ?? ({} as LocalSubscription)),
          ...entry.payload,
          ownerId,
          id: entry.entityId,
          user_id: ownerId,
        } as LocalSubscription);
      }
      continue;
    }

    if (entry.entity === "subscription_payment") {
      const payload = entry.payload;
      const subscriptionId = String(payload.subscription_id ?? "");
      if (entry.op === "DELETE") {
        subscriptionPayments.delete(entry.entityId);
        const sub = subscriptions.get(subscriptionId) ?? previousSubscriptions.get(subscriptionId);
        if (sub && typeof payload.due_date === "string") {
          subscriptions.set(subscriptionId, { ...sub, next_payment_date: payload.due_date } as LocalSubscription);
        }
        continue;
      }
      const base = subscriptionPayments.get(entry.entityId) ?? previousSubscriptionPayments.get(entry.entityId);
      subscriptionPayments.set(entry.entityId, {
        ...(base ?? ({} as LocalSubscriptionPayment)),
        ...payload,
        ownerId,
        id: entry.entityId,
        user_id: ownerId,
      } as LocalSubscriptionPayment);
      const sub = subscriptions.get(subscriptionId) ?? previousSubscriptions.get(subscriptionId);
      if (sub && typeof payload.next_payment_date === "string") {
        subscriptions.set(subscriptionId, { ...sub, next_payment_date: payload.next_payment_date } as LocalSubscription);
      }
      continue;
    }

    if (entry.entity === "bill") {
      if (entry.op === "DELETE") {
        bills.delete(entry.entityId);
        for (const [id, payment] of billPayments) if (payment.bill_id === entry.entityId) billPayments.delete(id);
        continue;
      }
      const base = bills.get(entry.entityId) ?? previousBills.get(entry.entityId);
      if (base || entry.op === "CREATE") {
        bills.set(entry.entityId, { ...(base ?? ({} as LocalBill)), ...entry.payload, ownerId, id: entry.entityId, user_id: ownerId } as LocalBill);
      }
      continue;
    }

    if (entry.entity === "bill_payment") {
      const payload = entry.payload;
      const billId = String(payload.bill_id ?? "");
      if (entry.op === "DELETE") {
        billPayments.delete(entry.entityId);
        const bill = bills.get(billId) ?? previousBills.get(billId);
        if (bill && typeof payload.rollback_due_date === "string") bills.set(billId, { ...bill, next_due_date: payload.rollback_due_date } as LocalBill);
        continue;
      }
      const base = billPayments.get(entry.entityId) ?? previousBillPayments.get(entry.entityId);
      billPayments.set(entry.entityId, { ...(base ?? ({} as LocalBillPayment)), ...payload, ownerId, id: entry.entityId, user_id: ownerId } as LocalBillPayment);
      const bill = bills.get(billId) ?? previousBills.get(billId);
      if (bill && typeof payload.next_due_date === "string") bills.set(billId, { ...bill, next_due_date: payload.next_due_date } as LocalBill);
      continue;
    }

    if (entry.entity === "installment_plan") {
      if (entry.op === "DELETE") {
        installmentPlans.delete(entry.entityId);
        for (const [id, payment] of installmentPayments) if (payment.installment_plan_id === entry.entityId) installmentPayments.delete(id);
        continue;
      }
      const base = installmentPlans.get(entry.entityId) ?? previousInstallmentPlans.get(entry.entityId);
      if (base || entry.op === "CREATE") {
        installmentPlans.set(entry.entityId, { ...(base ?? ({} as LocalInstallmentPlan)), ...entry.payload, ownerId, id: entry.entityId, user_id: ownerId } as LocalInstallmentPlan);
      }
      continue;
    }

    if (entry.entity === "installment_payment") {
      const payload = entry.payload;
      const planId = String(payload.installment_plan_id ?? "");
      const plan = installmentPlans.get(planId) ?? previousInstallmentPlans.get(planId);
      if (plan && typeof payload.plan_lifecycle === "string") {
        installmentPlans.set(planId, { ...plan, lifecycle: payload.plan_lifecycle } as LocalInstallmentPlan);
      }
      if (typeof payload.previous_transaction_id === "string") transactions.delete(payload.previous_transaction_id);
      if (entry.op === "DELETE") {
        installmentPayments.delete(entry.entityId);
        if (payload.transaction_origin === "created" && typeof payload.transaction_id === "string") transactions.delete(payload.transaction_id);
        continue;
      }
      const base = installmentPayments.get(entry.entityId) ?? previousInstallmentPayments.get(entry.entityId);
      installmentPayments.set(entry.entityId, { ...(base ?? ({} as LocalInstallmentPayment)), ...installmentPaymentRow(payload), ownerId, id: entry.entityId, user_id: ownerId } as LocalInstallmentPayment);
      const txRow = payload.transaction_row;
      if (payload.transaction_origin === "created" && typeof payload.transaction_id === "string" && txRow && typeof txRow === "object") {
        const txBase = transactions.get(payload.transaction_id) ?? previousTransactions.get(payload.transaction_id);
        transactions.set(payload.transaction_id, {
          ...(txBase ?? ({} as LocalTransaction)),
          ...(txRow as Record<string, unknown>),
          ownerId,
          id: payload.transaction_id,
          user_id: ownerId,
        } as LocalTransaction);
      }
      continue;
    }

    if (entry.op === "DELETE") {
      budget = null;
    } else {
      budget = {
        ...(budget ?? previous.budget ?? ({} as LocalMonthlyBudget)),
        ...entry.payload,
        ownerId,
        id: budget?.id ?? previous.budget?.id ?? entry.entityId,
        user_id: ownerId,
      } as LocalMonthlyBudget;
    }
  }

  return {
    accounts: [...accounts.values()],
    categories: [...categories.values()],
    transactions: [...transactions.values()],
    budget,
    dailyLimits: [...dailyLimits.values()],
    dailyExpenses: [...dailyExpenses.values()],
    subscriptions: [...subscriptions.values()],
    subscriptionPayments: [...subscriptionPayments.values()],
    bills: [...bills.values()],
    billPayments: [...billPayments.values()],
    installmentPlans: [...installmentPlans.values()],
    installmentPayments: [...installmentPayments.values()],
  };
}
