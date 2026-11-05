import Link from "next/link";
import { Landmark } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import type { AccountTotal } from "@/lib/reports";
import type { SupportedCurrency } from "@/lib/supabase/profile";

function signed(value: number, currency: SupportedCurrency) {
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${prefix}${formatMoney(Math.abs(value), currency)}`;
}

/** Income, expenses and net cash flow for each account with activity in the period. */
export function AccountReport({
  accounts,
  currency,
  hiddenCurrencyCount,
}: {
  accounts: AccountTotal[];
  currency: SupportedCurrency;
  /** Accounts with activity in other currencies (shown when switching currency). */
  hiddenCurrencyCount: number;
}) {
  return (
    <Card
      title="By account"
      description={hiddenCurrencyCount > 0 ? `${currency} accounts · switch currency above for others` : undefined}
      bodyClassName="pt-3"
    >
      {accounts.length === 0 ? (
        <EmptyState icon={<Landmark className="h-5 w-5" />} title="No account activity in this period" />
      ) : (
        <ul className="divide-y divide-line">
          {accounts.map((account) => {
            const flow = account.income + account.expense;
            const incomeShare = flow > 0 ? (account.income / flow) * 100 : 0;
            const content = (
              <>
                <div className="flex items-center gap-3">
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand text-accent-fg">
                    <span className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent" />
                    <Landmark className="relative h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                      <span className="truncate">{account.name}</span>
                      {account.trashed && (
                        <span className="shrink-0 rounded-full border border-line bg-glass-hover px-2 py-px text-[10px] font-semibold text-fg-subtle">
                          In Trash
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-fg-subtle">
                      {account.count} transaction{account.count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "shrink-0 text-right font-money text-sm font-bold",
                      account.net > 0 ? "text-positive" : account.net < 0 ? "text-danger" : "text-fg"
                    )}
                  >
                    {signed(account.net, currency)}
                    <span className="block font-sans text-[10px] font-medium text-fg-subtle">Net</span>
                  </p>
                </div>

                {/* Income vs expense share of this account's cash flow */}
                <div className="mt-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                  {account.income > 0 && <span className="rounded-full bg-positive" style={{ flexGrow: incomeShare }} />}
                  {account.expense > 0 && <span className="rounded-full bg-danger" style={{ flexGrow: 100 - incomeShare }} />}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-3 text-[11px]">
                  <div className="min-w-0">
                    <dt className="text-fg-subtle">Income</dt>
                    <dd className="truncate font-money text-[13px] font-bold text-positive">
                      {formatMoney(account.income, currency)}
                    </dd>
                  </div>
                  <div className="min-w-0 text-right">
                    <dt className="text-fg-subtle">Expenses</dt>
                    <dd className="truncate font-money text-[13px] font-bold text-danger">
                      {formatMoney(account.expense, currency)}
                    </dd>
                  </div>
                </dl>
              </>
            );

            return (
              <li key={account.id} className="py-3 first:pt-0 last:pb-0">
                {account.trashed ? (
                  <div>{content}</div>
                ) : (
                  <Link
                    href={`/accounts/${account.id}`}
                    className="-mx-2 block rounded-xl px-2 py-1 transition-colors hover:bg-glass-hover"
                  >
                    {content}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
