"use client";

import { setAccountArchivedAction } from "@/app/actions/accounts";
import { markOfflineDataStale } from "@/lib/offline/bootstrap";
import { runMutation, setAccountArchivedLocally } from "@/lib/offline/mutations";

/**
 * Archive or unarchive an account through the usual route: the Server Action online, or this
 * device's outbox when offline / when changes are already queued.
 */
export async function changeAccountArchived(accountId: string, archived: boolean) {
  const result = await runMutation({
    local: (ownerId) => setAccountArchivedLocally(ownerId, accountId, archived),
    remote: () => setAccountArchivedAction(accountId, archived),
  });
  if (result.success && !result.queued) markOfflineDataStale(["accounts", "dashboard"]);
  return result;
}
