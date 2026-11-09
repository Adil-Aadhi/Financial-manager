import { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Clock3 } from "lucide-react";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import type { TrashedAccountListItem } from "@/components/accounts/AccountTrashList";
import { OfflineAccountTrashList } from "@/components/accounts/OfflineAccountTrashList";
import { TIME_ZONE_COOKIE, resolveTimeZone } from "@/lib/month";

export const instant = false;

export const metadata: Metadata = {
  title: "Trash | AccountTracker",
  description: "Restore soft-deleted accounts and transactions.",
};

export default async function TrashPage() {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const cookieStore = await cookies();
  const timeZone = resolveTimeZone(cookieStore.get(TIME_ZONE_COOKIE)?.value);

  const supabase = await createClient();
  const trashedAccountsResult = await supabase
    .from("accounts")
    .select("id, name, opening_balance, currency, deleted_at")
    .eq("user_id", user.id)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  const accountTrashReady = trashedAccountsResult.error?.code !== "42703";
  let trashedAccounts: TrashedAccountListItem[] = [];

  if (accountTrashReady && !trashedAccountsResult.error) {
    trashedAccounts = (trashedAccountsResult.data ?? []).flatMap((account) =>
      account.deleted_at
        ? [{ ...account, deleted_at: account.deleted_at }]
        : []
    );
  } else if (
    trashedAccountsResult.error &&
    trashedAccountsResult.error.code !== "42703"
  ) {
    console.error(
      "Error fetching trashed accounts:",
      trashedAccountsResult.error.message
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Management"
        title="Trash"
        description="Review and restore soft-deleted accounts and their transaction histories."
      />

      <div className="space-y-5">
        {!accountTrashReady ? (
          <Alert variant="warning" title="Database update required">
            Trash will activate after the account-trash migration is run in Supabase.
          </Alert>
        ) : (
          <>
            <div className="glass glass-edge rounded-2xl p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Clock3 className="h-4 w-4" />
                </span>
                <div className="text-xs leading-relaxed text-fg-muted sm:text-sm">
                  <p className="font-semibold text-fg">10-day retention policy</p>
                  <p className="mt-0.5">
                    Accounts and their transaction history are permanently deleted after
                    10 days. You can restore them anytime during this retention period.
                  </p>
                </div>
              </div>
            </div>

            <Card
              title="Deleted Accounts"
              description="Soft-deleted accounts available for recovery."
              bodyClassName="pt-2"
            >
              <OfflineAccountTrashList
                ownerId={user.id}
                serverAccounts={trashedAccounts}
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
