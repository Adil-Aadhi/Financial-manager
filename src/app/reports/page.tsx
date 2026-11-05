import { Suspense } from "react";
import { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CalendarSearch } from "lucide-react";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { getReportSource } from "@/lib/supabase/reports";
import { TIME_ZONE_COOKIE, resolveTimeZone } from "@/lib/month";
import { buildReport, getReportRange } from "@/lib/reports";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { AccountReport } from "@/components/reports/AccountReport";
import { CategoryBreakdown } from "@/components/reports/CategoryBreakdown";
import { MonthlyComparison } from "@/components/reports/MonthlyComparison";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { ReportOverview } from "@/components/reports/ReportOverview";
import { ReportsSkeleton } from "@/components/reports/ReportsSkeleton";
import { Alert } from "@/components/ui/Alert";
import { buttonBase, buttonSizes, buttonVariants } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";

export const instant = false;

export const metadata: Metadata = {
  title: "Reports | FinanceTracker",
  description: "Income, spending and savings trends.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const name = profile.full_name || user.email?.split("@")[0] || "User";

  return (
    <AppShell userName={name} userEmail={user.email} currency={profile.default_currency}>
      <PageHeader title="Reports" description="Income, spending and savings for any period." />
      <Suspense fallback={<ReportsSkeleton />}>
        <ReportContent
          userId={user.id}
          defaultCurrency={profile.default_currency}
          searchParams={searchParams}
        />
      </Suspense>
    </AppShell>
  );
}

async function ReportContent({
  userId,
  defaultCurrency,
  searchParams,
}: {
  userId: string;
  defaultCurrency: SupportedCurrency;
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const range = getReportRange(
    { range: first(params.range), from: first(params.from), to: first(params.to) },
    resolveTimeZone(cookieStore.get(TIME_ZONE_COOKIE)?.value)
  );

  let source;
  try {
    const supabase = await createClient();
    source = await getReportSource(supabase, userId, range);
  } catch (error) {
    console.error("Error loading reports:", error instanceof Error ? error.message : error);
    return (
      <Card>
        <EmptyState
          icon={<CalendarSearch className="h-5 w-5" />}
          title="Couldn't load your reports"
          description="Check your connection and try again."
          action={
            <Link href="/reports" className={cn(buttonBase, buttonVariants.secondary, buttonSizes.sm)}>
              Try again
            </Link>
          }
          className="py-12"
        />
      </Card>
    );
  }

  const report = buildReport(
    source.rows,
    source.accounts,
    source.categories,
    range,
    first(params.currency),
    defaultCurrency
  );
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

        {report.count === 0 ? (
          <Card>
            <EmptyState
              icon={<CalendarSearch className="h-5 w-5" />}
              title="No transactions in this period"
              description="Pick another range, or add a transaction with +."
              className="py-12"
            />
          </Card>
        ) : (
          <>
            <ReportOverview
              income={report.income}
              expense={report.expense}
              net={report.net}
              savingsRate={report.savingsRate}
              count={report.count}
              currency={currency}
            />

            <MonthlyComparison key={sectionKey} months={report.months} currency={currency} />

            <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
              <CategoryBreakdown
                key={`expense-${sectionKey}`}
                title="Expense breakdown"
                type="expense"
                items={report.expenseCategories}
                total={report.expense}
                currency={currency}
              />
              <CategoryBreakdown
                key={`income-${sectionKey}`}
                title="Income breakdown"
                type="income"
                items={report.incomeCategories}
                total={report.income}
                currency={currency}
              />
            </div>

            <AccountReport
              accounts={report.accounts}
              currency={currency}
              hiddenCurrencyCount={report.currencies.length - 1}
            />
          </>
        )}

        {!source.aggregatedInDatabase && (
          <p className="text-center text-[11px] text-fg-subtle">
            Reports are calculated without the reports migration. Apply it for faster loading.
          </p>
        )}
      </div>
    </ReportFilters>
  );
}
