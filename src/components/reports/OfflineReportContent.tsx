"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { CalendarSearch, Trash2 } from "lucide-react";
import { AccountReport } from "@/components/reports/AccountReport";
import { CategoryBreakdown } from "@/components/reports/CategoryBreakdown";
import { MonthlyComparison } from "@/components/reports/MonthlyComparison";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { ReportOverview } from "@/components/reports/ReportOverview";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { normalizeIncludeInSummary } from "@/lib/accountSummary";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import { useLocalContentMark } from "@/lib/perf";
import {
  buildReport,
  type ReportData,
  type ReportRange,
  type ReportRollupRow,
} from "@/lib/reports";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { normalizeTransactionDate } from "@/lib/transactions";

export function OfflineReportContent({
  ownerId,
  defaultCurrency,
  requestedCurrency,
  range,
  serverReport,
  serverAggregated,
}: {
  ownerId: string;
  defaultCurrency: SupportedCurrency;
  requestedCurrency?: string;
  range: ReportRange;
  serverReport: ReportData;
  serverAggregated: boolean;
}) {
  const serverVersion = `${range.start}:${range.end}:${serverReport.currency}:${serverReport.count}:${serverReport.income}:${serverReport.expense}`;

  useOfflineRefresh(ownerId, serverVersion, "offline reports");

  const localReport = useLiveQuery(async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.totalsMatch) return null;
    const [transactions, accounts, categories, profile] = await Promise.all([
      offlineDb.transactions.where("ownerId").equals(ownerId).toArray(),
      offlineDb.accounts.where("ownerId").equals(ownerId).toArray(),
      offlineDb.categories.where("ownerId").equals(ownerId).toArray(),
      offlineDb.profiles.get(ownerId),
    ]);
    const localDefaultCurrency = isSupportedCurrency(profile?.default_currency)
      ? profile.default_currency
      : defaultCurrency;

    const groups = new Map<string, ReportRollupRow>();
    for (const transaction of transactions) {
      const date = normalizeTransactionDate(transaction.transaction_date);
      if (!date) continue;
      if (date < range.start || date > range.end) continue;
      const month = `${date.slice(0, 7)}-01`;
      const key = `${transaction.account_id}|${transaction.category_id}|${transaction.type}|${month}`;
      const row = groups.get(key) ?? {
        account_id: transaction.account_id,
        category_id: transaction.category_id || null,
        type: transaction.type,
        month,
        total: 0,
        tx_count: 0,
      };
      row.total = Number(row.total) + (Number(transaction.amount) || 0);
      row.tx_count = Number(row.tx_count) + 1;
      groups.set(key, row);
    }

    return buildReport(
      [...groups.values()],
      accounts.map((account) => ({
        id: account.id,
        name: account.name,
        currency: account.currency,
        trashed: Boolean(account.deleted_at),
        include_in_summary: normalizeIncludeInSummary(account.include_in_summary),
      })),
      categories.map((category) => ({
        id: category.id,
        name: category.name,
        icon: category.icon,
      })),
      range,
      requestedCurrency,
      localDefaultCurrency
    );
  }, [defaultCurrency, ownerId, range.end, range.start, requestedCurrency]);
  useLocalContentMark(localReport != null); // TEMPORARY perf (Step 3 Phase 0)

  const report = localReport ?? serverReport;
  const currency = report.currency as SupportedCurrency;
  const sectionKey = `${range.start}|${range.end}|${currency}`;

  return (
    <ReportFilters
      preset={range.preset}
      start={range.start}
      end={range.end}
      label={range.label}
      currency={currency}
      currencies={report.currencies}
    >
      <div className="space-y-4 sm:space-y-5">
        {range.notice && <Alert variant="warning">{range.notice}</Alert>}
        {report.trashedExcluded > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
            <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {report.trashedExcluded === 1
                ? "1 account in Trash isn't included. Restoring it brings its transactions back."
                : `${report.trashedExcluded} accounts in Trash aren't included. Restoring them brings their transactions back.`}{" "}
              <Link href="/trash" className="font-medium text-accent hover:text-accent-strong">
                Open Trash
              </Link>
            </span>
          </p>
        )}
        {report.count === 0 ? (
          <Card>
            <EmptyState
              icon={<CalendarSearch className="h-5 w-5" />}
              title={
                report.accounts.length > 0
                  ? "No included account activity in this period"
                  : "No transactions in this period"
              }
              description={
                report.accounts.length > 0
                  ? "Excluded accounts remain available in the account report below."
                  : "Pick another range, or add a transaction with +."
              }
              className="py-12"
            />
          </Card>
        ) : (
          <>
            <ReportOverview income={report.income} expense={report.expense} net={report.net} savingsRate={report.savingsRate} count={report.count} currency={currency} />
            <MonthlyComparison key={sectionKey} months={report.months} currency={currency} />
            <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
              <CategoryBreakdown key={`expense-${sectionKey}`} title="Expense breakdown" type="expense" items={report.expenseCategories} total={report.expense} currency={currency} />
              <CategoryBreakdown key={`income-${sectionKey}`} title="Income breakdown" type="income" items={report.incomeCategories} total={report.income} currency={currency} />
            </div>
          </>
        )}
        {report.accounts.length > 0 && (
          <AccountReport
            accounts={report.accounts}
            currency={currency}
            hiddenCurrencyCount={report.currencies.length - 1}
          />
        )}
        {!localReport && !serverAggregated && (
          <p className="text-center text-[11px] text-fg-subtle">
            Reports are calculated without the reports migration. Apply it for faster server fallback loading.
          </p>
        )}
      </div>
    </ReportFilters>
  );
}

function isSupportedCurrency(value: string | null | undefined): value is SupportedCurrency {
  return value === "INR" || value === "USD" || value === "AED";
}
