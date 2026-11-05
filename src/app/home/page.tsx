import { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Landmark,
  PieChart,
  PiggyBank,
  ReceiptText,
  Wallet,
} from "lucide-react";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Card, CardLink } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const instant = false;

export const metadata: Metadata = {
  title: "Home | FinanceTracker",
  description: "Your balance, cash flow and recent activity.",
};

const summary = {
  totalBalance: 0,
  accountCount: 0,
  monthIncome: 0,
  monthExpenses: 0,
};

export default async function HomePage() {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const name = profile.full_name || user.email?.split("@")[0] || "there";
  const firstName = name.split(" ")[0];
  const currency = profile.default_currency;
  const saved = summary.monthIncome - summary.monthExpenses;

  const supabase = await createClient();
  const accountsResult = await supabase
    .from("accounts")
    .select("id, name, opening_balance, currency")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  let accounts = accountsResult.data;

  if (accountsResult.error?.code === "42703") {
    const legacyAccountsResult = await supabase
      .from("accounts")
      .select("id, name, opening_balance, currency")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    accounts = legacyAccountsResult.data;
  }

  const totalAccountCount = accounts?.length ?? 0;
  const calculatedTotalBalance =
    accounts?.reduce(
      (sum, acc) => sum + (Number(acc.opening_balance) || 0),
      0
    ) ?? 0;

  return (
    <AppShell userName={name} userEmail={user.email} currency={currency}>
      <PageHeader eyebrow="Overview" title={`Hi, ${firstName}`} />

      <div className="space-y-5">
        {/* Balance hero */}
        <section className="glass-strong glass-edge animate-rise overflow-hidden rounded-3xl p-5 sm:p-7">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,var(--aurora-1),transparent_70%)]" />

          <div className="relative flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
              <Wallet className="h-4 w-4 text-accent" />
              Total balance
            </span>
            <span className="rounded-full border border-line bg-glass-hover px-2.5 py-0.5 font-mono text-[11px] font-semibold text-fg-muted">
              {currency}
            </span>
          </div>

          <p className="relative mt-3 font-mono text-[34px] font-semibold leading-none tracking-tight text-fg sm:text-5xl">
            {formatMoney(calculatedTotalBalance, currency)}
          </p>
          <p className="relative mt-2 text-xs text-fg-subtle">
            {totalAccountCount === 0
              ? "No accounts yet"
              : `Across ${totalAccountCount} account${totalAccountCount === 1 ? "" : "s"}`}
          </p>

          <div className="relative mt-6 grid grid-cols-3 gap-2 sm:gap-3">
            <MonthStat
              label="Income"
              value={formatMoney(summary.monthIncome, currency, { compact: true })}
              icon={<ArrowDownLeft className="h-3.5 w-3.5" />}
              tone="positive"
            />
            <MonthStat
              label="Expenses"
              value={formatMoney(summary.monthExpenses, currency, { compact: true })}
              icon={<ArrowUpRight className="h-3.5 w-3.5" />}
              tone="negative"
            />
            <MonthStat
              label="Saved"
              value={formatMoney(saved, currency, { compact: true })}
              icon={<PiggyBank className="h-3.5 w-3.5" />}
              tone={saved < 0 ? "negative" : "neutral"}
            />
          </div>
          <p className="relative mt-3 text-[11px] text-fg-subtle">This month</p>
        </section>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card
              title="Recent transactions"
              action={<CardLink href="/transactions">View all</CardLink>}
              bodyClassName="pt-2"
            >
              <EmptyState
                icon={<ReceiptText className="h-5 w-5" />}
                title="No transactions yet"
                description="Tap + to record your first income or expense."
              />
            </Card>

            <Card title="Cash flow" description="Income vs expenses · last 6 months">
              <EmptyChart />
            </Card>
          </div>

          <div className="space-y-5">
            <Card title="Accounts" bodyClassName="pt-2">
              {accounts && accounts.length > 0 ? (
                <div className="space-y-2 p-1">
                  {accounts.map((acc) => (
                    <Link
                      key={acc.id}
                      href={`/accounts/${acc.id}`}
                      className="flex items-center justify-between rounded-xl border border-line bg-glass-hover p-3 transition-colors hover:border-accent/40"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                          <Landmark className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-fg">{acc.name}</p>
                          <p className="font-mono text-[11px] text-fg-subtle">
                            {formatMoney(
                              Number(acc.opening_balance) || 0,
                              acc.currency || currency
                            )}
                          </p>
                        </div>
                      </div>
                      <ArrowUpRight className="h-4 w-4 text-fg-subtle" />
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Landmark className="h-5 w-5" />}
                  title="No accounts yet"
                  description="Bank, cash, UPI and cards will show here."
                />
              )}
            </Card>

            <Card title="Top spending" description="This month" bodyClassName="pt-2">
              <EmptyState icon={<PieChart className="h-5 w-5" />} title="Nothing spent yet" />
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function MonthStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "positive" | "negative" | "neutral";
}) {
  return (
    <div className="rounded-2xl border border-line bg-glass-hover p-3 sm:p-4">
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-lg",
          tone === "positive" && "bg-positive/12 text-positive",
          tone === "negative" && "bg-danger/12 text-danger",
          tone === "neutral" && "bg-accent-3/12 text-accent-3"
        )}
      >
        {icon}
      </span>
      <p className="mt-2.5 text-[11px] font-medium text-fg-subtle">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate font-mono text-sm font-semibold sm:text-base",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-danger",
          tone === "neutral" && "text-fg"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyChart() {
  const bars = [38, 55, 30, 62, 45, 70];
  return (
    <div className="relative">
      <div className="flex h-40 items-end justify-between gap-3 px-1" aria-hidden="true">
        {bars.map((h, i) => (
          <div key={i} className="flex flex-1 items-end justify-center gap-1">
            <span className="w-full max-w-4 rounded-t-md bg-line-strong" style={{ height: `${h}%` }} />
            <span className="w-full max-w-4 rounded-t-md bg-line" style={{ height: `${h * 0.7}%` }} />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="glass flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-fg-muted">
          <BarChart3 className="h-3.5 w-3.5 text-accent" />
          Your trend appears after a few transactions
        </span>
      </div>
    </div>
  );
}
