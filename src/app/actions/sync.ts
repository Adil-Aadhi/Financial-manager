"use server";

import { revalidatePath } from "next/cache";
import { runSyncBatch } from "@/lib/server/syncApply";
import { createClient } from "@/lib/supabase/server";
import type { SyncBatchResponse } from "@/lib/sync/types";

/**
 * Applies a batch of offline changes (the device's outbox, in order). Authentication uses the
 * same getUser() check as every other mutation; the payload's ownerId/user_id are never trusted.
 * See runSyncBatch for validation, idempotency and conflict rules.
 */
export async function syncOutboxAction(operations: unknown): Promise<SyncBatchResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "auth", results: [], error: "Sign in again to sync your changes." };

  const response = await runSyncBatch(supabase, user.id, operations);

  if (response.results.some((result) => result.status === "applied")) {
    revalidatePath("/home");
    revalidatePath("/transactions");
    revalidatePath("/reports");
    revalidatePath("/categories");
    revalidatePath("/trash");
    revalidatePath("/daily-budget");
    revalidatePath("/subscriptions");
    revalidatePath("/bills");
    revalidatePath("/accounts/[id]", "page");
  }
  return response;
}
