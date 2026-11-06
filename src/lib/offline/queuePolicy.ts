export interface QueuePolicyEntry {
  seq?: number;
  entity: "transaction" | "account" | "category" | "budget";
  entityId: string;
  op: "CREATE" | "UPDATE" | "DELETE";
  payload: Record<string, unknown>;
  status: "pending" | "syncing" | "failed";
  nextAttemptAt?: number;
}

export function canCoalesce(entries: Array<Pick<QueuePolicyEntry, "status"> & { attempts: number }>) {
  return (
    entries.length > 0 &&
    entries.every((entry) => entry.status === "pending" && entry.attempts === 0)
  );
}

function references(payload: Record<string, unknown>, field: string, id: string) {
  return typeof payload[field] === "string" && payload[field] === id;
}

/**
 * Whether `entry` must stay behind an earlier operation that cannot currently run.
 * Same-record ordering is always strict. Transaction writes also wait for the account/category
 * rows they reference. A category delete conservatively waits for an unresolved transaction
 * delete because older outbox rows did not record the deleted transaction's category id.
 */
export function dependsOn(entry: QueuePolicyEntry, earlier: QueuePolicyEntry) {
  if ((earlier.seq ?? 0) >= (entry.seq ?? Number.MAX_SAFE_INTEGER)) return false;
  if (entry.entity === earlier.entity && entry.entityId === earlier.entityId) return true;

  if (entry.entity === "transaction" && entry.op !== "DELETE") {
    if (earlier.entity === "account" && references(entry.payload, "account_id", earlier.entityId)) {
      return true;
    }
    if (
      earlier.entity === "category" &&
      references(entry.payload, "category_id", earlier.entityId)
    ) {
      return true;
    }
  }

  if (entry.entity === "category" && entry.op === "DELETE" && earlier.entity === "transaction") {
    return (
      earlier.op === "DELETE" || references(earlier.payload, "category_id", entry.entityId)
    );
  }

  return false;
}

export function selectRunnableEntries<T extends QueuePolicyEntry>(
  entries: T[],
  now: number,
  limit: number
) {
  const blockers: T[] = [];
  const runnable: T[] = [];

  for (const entry of entries) {
    if (entry.status === "failed" || entry.status === "syncing") {
      blockers.push(entry);
      continue;
    }
    if ((entry.nextAttemptAt ?? 0) > now) {
      blockers.push(entry);
      continue;
    }
    if (blockers.some((blocker) => dependsOn(entry, blocker))) {
      blockers.push(entry);
      continue;
    }
    if (runnable.length < limit) runnable.push(entry);
  }

  return runnable;
}
