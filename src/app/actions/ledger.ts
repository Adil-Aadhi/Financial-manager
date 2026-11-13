"use server";

import { revalidatePath } from "next/cache";
import { isLedgerEntity, isLedgerUuid, type LedgerChange } from "@/lib/ledger";
import { runSyncBatch } from "@/lib/server/syncApply";
import { createClient } from "@/lib/supabase/server";
import type { SyncOperation } from "@/lib/sync/types";

/**
 * Online path for the Personal Ledger. The changes go through exactly the code the offline outbox
 * uses (runSyncBatch), so validation, idempotency and the atomic database functions are identical
 * whether a change was made online or replayed after reconnecting. The user comes from the
 * session; nothing in the payload is trusted for ownership.
 */
export async function ledgerOperationsAction(changes: LedgerChange[]): Promise<{ success: boolean; error?: string }> {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 25) {
    return { success: false, error: "Unable to save this change." };
  }
  for (const change of changes) {
    if (
      !change ||
      !isLedgerEntity(change.entity) ||
      !["CREATE", "UPDATE", "DELETE"].includes(change.op) ||
      !isLedgerUuid(change.id) ||
      !change.payload ||
      typeof change.payload !== "object"
    ) {
      return { success: false, error: "Unable to save this change." };
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in to change the ledger." };

  const editedAt = new Date().toISOString();
  const operations: SyncOperation[] = changes.map((change, index) => ({
    opId: crypto.randomUUID(),
    seq: index + 1,
    ownerId: user.id,
    entity: change.entity,
    entityId: change.id,
    op: change.op,
    payload: change.payload,
    baseUpdatedAt: null,
    editedAt,
  }));

  const response = await runSyncBatch(supabase, user.id, operations);
  if (response.status !== "ok") return { success: false, error: response.error ?? "Unable to save this change." };
  const failed = response.results.find((result) => result.status !== "applied" && result.status !== "already-applied");
  if (failed || response.results.length < operations.length) {
    return { success: false, error: failed?.error ?? "Unable to save this change." };
  }
  revalidatePath("/ledger", "layout");
  return { success: true };
}
