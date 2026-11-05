import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Landmark } from "lucide-react";
import { AccountFABRegistrar } from "@/components/accounts/AccountFABRegistrar";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { TransactionHistory } from "@/components/transactions/TransactionHistory";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { getAuthenticatedUserProfile, type SupportedCurrency } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeTransactionDate,
  type TransactionCategoryOption,
  type TransactionRecord,
  type TransactionType,
} from "@/lib/transactions";

export const instant = false;

interface AccountPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: AccountPageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Account ${id} | FinanceTracker`,
    description: "Account balance and transaction history.",
  };
}

function isTransactionType(value: string): value is TransactionType {
  return value === "income" || value === "expense";
}

export default async function AccountDetailsPage({ params }: AccountPageProps) {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const { id } = await params;
  const supabase = await createClient();
  const accountResult = await supabase
    .from("accounts")
    .select("id, name, opening_balance, currency, created_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  let accountData = accountResult.data;
  if (accountResult.error?.code === "42703") {
    const legacyAccountResult = await supabase
      .from("accounts")
      .select("id, name, opening_balance, currency, created_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    accountData = legacyAccountResult.data;
  }
  if (!accountData) notFound();

  const withTimeResult = await supabase
    .from("transactions")
    .select(
      "id, account_id, category_id, type, amount, description, transaction_date, transaction_time, created_at, updated_at, categories(id, name, icon)"
    )
    .eq("user_id", user.id)
    .eq("account_id", id)
    .order("transaction_date", { ascending: false })
    .order("transaction_time", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const transactionTimeReady = withTimeResult.error?.code !== "42703";
  let transactionRows = withTimeResult.data ?? [];

  if (!transactionTimeReady) {
    const legacyTransactionsResult = await supabase
      .from("transactions")
      .select(
        "id, account_id, category_id, type, amount, description, transaction_date, created_at, updated_at, categories(id, name, icon)"
      )
      .eq("user_id", user.id)
      .eq("account_id", id)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });
    transactionRows =
      legacyTransactionsResult.data?.map((row) => ({
        ...row,
        transaction_time: null,
      })) ?? [];
    if (legacyTransactionsResult.error) {
      console.error("Error fetching account transactions:", legacyTransactionsResult.error.message);
    }
  } else if (withTimeResult.error) {
    console.error("Error fetching account transactions:", withTimeResult.error.message);
  }

  const categoriesResult = await supabase
    .from("categories")
    .select("id, name, type, icon, is_default")
    .or(`is_default.eq.true,user_id.eq.${user.id}`)
    .order("is_default", { ascending: false })
    .order("name");

  if (categoriesResult.error) {
    console.error("Error fetching transaction categories:", categoriesResult.error.message);
  }

  const categories: TransactionCategoryOption[] = (categoriesResult.data ?? []).flatMap(
    (category) =>
      isTransactionType(category.type)
        ? [{ ...category, type: category.type }]
        : []
  );

  const transactions: TransactionRecord[] = (transactionRows ?? []).flatMap((row) => {
    if (!isTransactionType(row.type)) return [];
    const categoryValue = row.categories;
    const category = Array.isArray(categoryValue) ? categoryValue[0] : categoryValue;
    return [
      {
        id: row.id,
        account_id: row.account_id,
        category_id: row.category_id,
        type: row.type,
        amount: row.amount,
        description: row.description,
        transaction_date: normalizeTransactionDate(row.transaction_date),
        transaction_time: row.transaction_time ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        category: category
          ? { id: category.id, name: category.name, icon: category.icon }
          : null,
      },
    ];
  });

  const totalIncome = transactions.reduce(
    (sum, transaction) =>
      transaction.type === "income" ? sum + (Number(transaction.amount) || 0) : sum,
    0
  );
  const totalExpense = transactions.reduce(
    (sum, transaction) =>
      transaction.type === "expense" ? sum + (Number(transaction.amount) || 0) : sum,
    0
  );
  const openingBalance = Number(accountData.opening_balance) || 0;
  const currentBalance = openingBalance + totalIncome - totalExpense;
  const currency = (accountData.currency as SupportedCurrency) || profile.default_currency;
  const userName = profile.full_name || user.email?.split("@")[0] || "User";

  return (
    <AppShell userName={userName} userEmail={user.email} currency={profile.default_currency}>
      <AccountFABRegistrar account={{ id: accountData.id, name: accountData.name }} />

      <PageHeader
        eyebrow="Account Details"
        title={accountData.name}
        description="Balance, totals, and complete transaction history."
      />

      <div className="space-y-4 sm:space-y-6">
        {!transactionTimeReady && (
          <Alert variant="warning" title="Database update required">
            Existing transactions are available. Run the transaction-time migration to add or edit entries with time support.
          </Alert>
        )}

        <section className="glass-strong glass-edge animate-rise overflow-hidden rounded-3xl p-4 sm:p-7">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,var(--aurora-1),transparent_70%)]" />

          <div className="relative flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
              <Landmark className="h-4 w-4 text-accent" /> Current balance
            </span>
            <span className="rounded-full border border-line bg-glass-hover px-2.5 py-0.5 font-mono text-[11px] font-semibold text-fg-muted">
              {currency}
            </span>
          </div>
          <p
            className={cn(
              "relative mt-3 font-money text-[30px] font-bold leading-none tracking-tight sm:text-5xl",
              currentBalance > 0 ? "text-positive" : currentBalance < 0 ? "text-danger" : "text-fg"
            )}
          >
            {formatMoney(currentBalance, currency)}
          </p>
          <p className="relative mt-2 text-xs text-fg-subtle">
            Opening{" "}
            <span className="font-money font-semibold">{formatMoney(openingBalance, currency)}</span>
            {" · "}
            {transactions.length} transaction{transactions.length === 1 ? "" : "s"}
          </p>

          <dl className="relative mt-5 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-3">
            <SummaryMetric label="Income" value={formatMoney(totalIncome, currency)} tone="positive" icon={<ArrowDownLeft className="h-3.5 w-3.5" />} />
            <SummaryMetric label="Expenses" value={formatMoney(totalExpense, currency)} tone="negative" icon={<ArrowUpRight className="h-3.5 w-3.5" />} />
          </dl>
        </section>

        <Card title="Activity" bodyClassName="pt-3">
          <TransactionHistory
            transactions={transactions}
            currency={currency}
            categories={categories}
          />
        </Card>
      </div>
    </AppShell>
  );
}

function SummaryMetric({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "positive" | "negative";
  icon: React.ReactNode;
}) {
  const positive = tone === "positive";
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-glass-hover p-3 sm:p-4">
      <dt className="flex items-center gap-2 text-[11px] font-medium text-fg-subtle">
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-lg",
            positive ? "bg-positive/12 text-positive" : "bg-danger/12 text-danger"
          )}
        >
          {icon}
        </span>
        {label}
      </dt>
      <dd
        className={cn(
          "mt-2 truncate font-money text-base font-bold sm:text-lg",
          positive ? "text-positive" : "text-danger"
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
