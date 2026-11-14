import type { createClient } from "@/lib/supabase/server";
import type { InstallmentPaymentRecord, InstallmentPlanRecord } from "@/lib/installments";
import { INSTALLMENT_CATEGORY_NAME, managedTransactions, type ManagedTransactionInfo } from "@/lib/installments";
import { normalizeTransactionDate } from "@/lib/transactions";

type ServerClient = Awaited<ReturnType<typeof createClient>>;
const MISSING_OBJECT_CODES = new Set(["42P01", "PGRST205", "42703"]);
const PAGE_SIZE = 1000;

export const INSTALLMENT_PLAN_COLUMNS =
  "id, user_id, name, description, plan_type, provider, product_category, icon, original_amount, down_payment, financed_amount, interest_amount, additional_fees, total_repayment_amount, currency, installment_count, default_installment_amount, billing_cycle, billing_interval, start_date, first_due_date, reminder_days, lifecycle, notes, created_at, updated_at";
export const INSTALLMENT_PAYMENT_COLUMNS =
  "id, user_id, installment_plan_id, installment_number, kind, covers_through, due_date, expected_amount, actual_amount, payment_date, payment_method, account_id, transaction_id, transaction_origin, notes, paid_at, created_at, updated_at";

export interface InstallmentAccountOption {
  id: string;
  name: string;
  currency: string | null;
  deleted_at: string | null;
  /** Archived accounts can't take new payments (missing before the archive migration). */
  archived_at?: string | null;
}

export interface InstallmentTransactionOption {
  id: string;
  account_id: string;
  category_id: string;
  type: string;
  amount: number | string;
  description: string | null;
  transaction_date: string;
  transaction_time?: string | null;
}

export interface InstallmentsServerData {
  available: boolean;
  plans: InstallmentPlanRecord[];
  payments: InstallmentPaymentRecord[];
  /** Read only, for the payment method account selector. */
  accounts: InstallmentAccountOption[];
  /** Read only: expense transactions referenced by payments plus recent ones for linking. */
  transactions: InstallmentTransactionOption[];
  categoryAvailable: boolean;
}

const EMPTY: InstallmentsServerData = { available: false, plans: [], payments: [], accounts: [], transactions: [], categoryAvailable: false };

export async function getInstallmentsServerData(supabase: ServerClient, userId: string): Promise<InstallmentsServerData> {
  const plansResult = await supabase.from("installment_plans").select(INSTALLMENT_PLAN_COLUMNS).eq("user_id", userId).order("first_due_date");
  if (MISSING_OBJECT_CODES.has(plansResult.error?.code ?? "")) return EMPTY;
  if (plansResult.error) {
    console.error("Error fetching installment plans:", plansResult.error.message);
    return { ...EMPTY, available: true };
  }

  const payments: InstallmentPaymentRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await supabase
      .from("installment_payments")
      .select(INSTALLMENT_PAYMENT_COLUMNS)
      .eq("user_id", userId)
      .order("installment_number")
      .range(from, from + PAGE_SIZE - 1);
    if (page.error) {
      if (MISSING_OBJECT_CODES.has(page.error.code ?? "")) return EMPTY;
      console.error("Error fetching installment payments:", page.error.message);
      break;
    }
    payments.push(...((page.data ?? []) as InstallmentPaymentRecord[]));
    if ((page.data ?? []).length < PAGE_SIZE) break;
  }

  const referenced = [...new Set(payments.map((payment) => payment.transaction_id).filter((id): id is string => Boolean(id)))];
  const transactionColumns = "id, account_id, category_id, type, amount, description, transaction_date, transaction_time";
  const [accountsResult, recentResult, referencedResult, categoryResult] = await Promise.all([
    // "*" keeps working before the archive migration adds archived_at.
    supabase.from("accounts").select("*").eq("user_id", userId).order("name"),
    supabase
      .from("transactions")
      .select(transactionColumns)
      .eq("user_id", userId)
      .eq("type", "expense")
      .order("transaction_date", { ascending: false })
      .limit(150),
    referenced.length
      ? supabase.from("transactions").select(transactionColumns).eq("user_id", userId).in("id", referenced.slice(0, 500))
      : Promise.resolve({ data: [], error: null }),
    supabase.from("categories").select("id, name").eq("is_default", true).eq("type", "expense").ilike("name", INSTALLMENT_CATEGORY_NAME),
  ]);

  const transactions = new Map<string, InstallmentTransactionOption>();
  for (const row of [...((recentResult.data ?? []) as InstallmentTransactionOption[]), ...((referencedResult.data ?? []) as InstallmentTransactionOption[])]) {
    transactions.set(row.id, { ...row, transaction_date: normalizeTransactionDate(row.transaction_date) ?? row.transaction_date });
  }

  return {
    available: true,
    plans: (plansResult.data ?? []) as InstallmentPlanRecord[],
    payments,
    accounts: ((accountsResult.data ?? []) as InstallmentAccountOption[]).map(({ id, name, currency, deleted_at, archived_at }) => ({
      id,
      name,
      currency,
      deleted_at,
      archived_at: archived_at ?? null,
    })),
    transactions: [...transactions.values()],
    categoryAvailable: ((categoryResult.data ?? []) as Array<{ name: string }>).some(
      (category) => category.name.trim().toLowerCase() === INSTALLMENT_CATEGORY_NAME.toLowerCase()
    ),
  };
}

/**
 * Installment-generated expenses on one account (read only), so the account page can show them
 * as managed by Installments before the device's local copy is ready. Empty before the migration.
 */
export async function getManagedTransactionsForAccount(
  supabase: ServerClient,
  userId: string,
  accountId: string
): Promise<ManagedTransactionInfo[]> {
  const payments = await supabase
    .from("installment_payments")
    .select("id, installment_plan_id, installment_number, kind, covers_through, transaction_id, transaction_origin")
    .eq("user_id", userId)
    .eq("account_id", accountId)
    .eq("transaction_origin", "created");
  if (payments.error) {
    if (!MISSING_OBJECT_CODES.has(payments.error.code ?? "")) console.error("Error fetching installment payments:", payments.error.message);
    return [];
  }
  const rows = (payments.data ?? []) as InstallmentPaymentRecord[];
  if (!rows.length) return [];
  const planIds = [...new Set(rows.map((row) => row.installment_plan_id))];
  const plans = await supabase.from("installment_plans").select("id, name, installment_count").eq("user_id", userId).in("id", planIds);
  return [...managedTransactions(rows, (plans.data ?? []) as InstallmentPlanRecord[]).values()];
}
