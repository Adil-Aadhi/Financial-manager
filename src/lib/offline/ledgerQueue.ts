import { isLedgerEntity, type LedgerShare } from "@/lib/ledger";

interface LedgerQueueEntry {
  entity: string;
  entityId: string;
  op: string;
  payload: Record<string, unknown>;
}

const REFERENCE_FIELDS = ["person_id", "group_id", "member_id", "obligation_id"] as const;

/** Ids of the other records this change needs to exist first. */
function referencedIds(entry: LedgerQueueEntry) {
  const ids: string[] = [];
  for (const field of REFERENCE_FIELDS) {
    const value = entry.payload[field];
    if (typeof value === "string") ids.push(value);
  }
  if (Array.isArray(entry.payload.shares)) {
    for (const share of entry.payload.shares as LedgerShare[]) {
      if (typeof share?.person_id === "string") ids.push(share.person_id);
    }
  }
  return ids;
}

/** Ids this change creates or changes: its own record, plus an expense's shares. */
function ownIds(entry: LedgerQueueEntry) {
  const ids = [entry.entityId];
  if (Array.isArray(entry.payload.shares)) {
    for (const share of entry.payload.shares as LedgerShare[]) {
      if (typeof share?.id === "string") ids.push(share.id);
    }
  }
  return ids;
}

/**
 * Whether a queued ledger change must stay behind an earlier one that can't run yet:
 *   - it references a record the earlier change creates (a payment needs its due, a due needs its
 *     person and member, a member needs its person and group, an expense needs its people);
 *   - it deletes a record an earlier change still references;
 *   - an expense delete waits for earlier payments, because it can't know which dues they target.
 */
export function ledgerDependsOn(entry: LedgerQueueEntry, earlier: LedgerQueueEntry) {
  if (!isLedgerEntity(entry.entity) || !isLedgerEntity(earlier.entity)) return false;
  const earlierOwn = ownIds(earlier);
  if (referencedIds(entry).some((id) => earlierOwn.includes(id))) return true;
  if (entry.op === "DELETE") {
    if (referencedIds(earlier).includes(entry.entityId)) return true;
    if (entry.entity === "ledger_expense" && earlier.entity === "ledger_payment") return true;
  }
  return false;
}
