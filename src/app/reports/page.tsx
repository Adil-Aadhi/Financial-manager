import { Suspense } from "react";
import { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { getReportSource } from "@/lib/supabase/reports";
import { TIME_ZONE_COOKIE, resolveTimeZone } from "@/lib/month";
import { buildReport, getReportRange } from "@/lib/reports";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { OfflineReportContent } from "@/components/reports/OfflineReportContent";
import { ReportsSkeleton } from "@/components/reports/ReportsSkeleton";

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
    source = { rows: [], accounts: [], categories: [], aggregatedInDatabase: false };
  }

  const report = buildReport(
    source.rows,
    source.accounts,
    source.categories,
    range,
    first(params.currency),
    defaultCurrency
  );
  return (
    <OfflineReportContent
      ownerId={userId}
      defaultCurrency={defaultCurrency}
      requestedCurrency={first(params.currency)}
      range={range}
      serverReport={report}
      serverAggregated={source.aggregatedInDatabase}
    />
  );
}
