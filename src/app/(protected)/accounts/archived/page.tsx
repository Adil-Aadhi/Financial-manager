import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Info } from "lucide-react";
import { ArchivedAccountList, type ArchivedAccountItem } from "@/components/accounts/ArchivedAccountList";
import { PageHeader } from "@/components/layout/AppShell";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { TIME_ZONE_COOKIE, resolveTimeZone } from "@/lib/month";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export const metadata: Metadata = {
  title: "Archived Accounts | AccountTracker",
  description: "Accounts hidden from Transactions. Unarchive them anytime.",
};

export default async function ArchivedAccountsPage() {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const cookieStore = await cookies();
  const timeZone = resolveTimeZone(cookieStore.get(TIME_ZONE_COOKIE)?.value);
  const supabase = await createClient();

  const archivedResult = await supabase
    .from("accounts")
    .select("id, name, currency, opening_balance, archived_at")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });

  // 42703: the account-archive migration hasn't been applied yet.
  const migrationMissing = archivedResult.error?.code === "42703";
  if (archivedResult.error && !migrationMissing) {
    console.error("Error fetching archived accounts:", archivedResult.error.message);
  }
  const rows = archivedResult.error ? [] : archivedResult.data ?? [];

  const totals = new Map<string, { net: number; count: number }>();
  if (rows.length > 0) {
    const transactionsResult = await supabase
      .from("transactions")
      .select("account_id, type, amount")
      .eq("user_id", user.id)
      .in(
        "account_id",
        rows.map((row) => row.id)
      );
    for (const transaction of transactionsResult.data ?? []) {
      const entry = totals.get(transaction.account_id) ?? { net: 0, count: 0 };
      const amount = Number(transaction.amount) || 0;
      if (transaction.type === "income") entry.net += amount;
      if (transaction.type === "expense") entry.net -= amount;
      entry.count += 1;
      totals.set(transaction.account_id, entry);
    }
  }

  const accounts: ArchivedAccountItem[] = rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    currency: row.currency,
    archived_at: String(row.archived_at),
    balance: (Number(row.opening_balance) || 0) + (totals.get(String(row.id))?.net ?? 0),
    transactionCount: totals.get(String(row.id))?.count ?? 0,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Accounts"
        title="Archived accounts"
        description="Hidden from Transactions. Unarchive an account to use it again."
      />
      <div className="space-y-5">
        {migrationMissing ? (
          <Alert variant="warning" title="Database update required">
            Archiving will activate after the account-archive migration is run in Supabase.
          </Alert>
        ) : (
          <>
            <div className="glass glass-edge rounded-2xl p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Info className="h-4 w-4" />
                </span>
                <div className="text-xs leading-relaxed text-fg-muted sm:text-sm">
                  <p className="font-semibold text-fg">Archived accounts still count</p>
                  <p className="mt-0.5">
                    Their balance and history stay in Home and Reports. You can view their transactions, but
                    new transactions can&apos;t be added until you unarchive them.
                  </p>
                </div>
              </div>
            </div>
            <Card title="Archived" bodyClassName="pt-2">
              <ArchivedAccountList
                ownerId={user.id}
                serverAccounts={accounts}
                fallbackCurrency={profile.default_currency}
                timeZone={timeZone}
              />
            </Card>
          </>
        )}
      </div>
    </>
  );
}
