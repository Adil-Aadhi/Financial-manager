import "client-only";

import { ledgerOperationsAction } from "@/app/actions/ledger";
import { dailyBudgetToday } from "@/lib/dailyBudget";
import {
  LEDGER_NORMALIZERS,
  missingRecurringObligations,
  type LedgerChange,
  type LedgerEntity,
} from "@/lib/ledger";
import { validateLedgerChange } from "@/lib/ledgerRules";
import { getActiveOwnerId } from "@/lib/offline/activeOwner";
import { offlineDb } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/events";
import { overlayLedger, type LedgerLocalRows } from "@/lib/offline/ledgerOverlay";
import { ledgerTableList, readLedgerRows, replaceLedgerRows } from "@/lib/offline/ledgerTables";
import {
  LocalMutationError,
  enqueue,
  requireLocalSnapshot,
  shouldWriteLocally,
  type MutationOutcome,
} from "@/lib/offline/mutations";

/**
 * Personal Ledger writes. Every change is validated with the same normalisers the server uses,
 * applied to the device's IndexedDB copy and queued in the existing outbox in one Dexie
 * transaction: either both happen or neither does. The sync engine then sends it like any other
 * change, and the server applies it idempotently (a payment's id is its idempotency key).
 */

const ROW_KEY: Record<LedgerEntity, keyof LedgerLocalRows> = {
  ledger_person: "people",
  ledger_group: "groups",
  ledger_member: "members",
  ledger_rate: "rates",
  ledger_span: "spans",
  ledger_expense: "expenses",
  ledger_obligation: "obligations",
  ledger_payment: "payments",
};

/** Per pass, so a very old group can't queue thousands of dues in one transaction. */
const GENERATION_BATCH = 300;

async function requireLedger(ownerId: string) {
  await requireLocalSnapshot(ownerId);
  const meta = await offlineDb.syncMeta.get(ownerId);
  if (meta?.ledgerAvailable !== true) {
    throw new LocalMutationError("The Personal Ledger isn't ready on this device yet. Connect to the internet once, then try again.");
  }
}

function transactionTables() {
  return [...ledgerTableList(), offlineDb.syncMeta, offlineDb.outbox];
}

/** Validates and applies one change to `rows` and the outbox. Returns the updated rows. */
async function applyChange(ownerId: string, rows: LedgerLocalRows, change: LedgerChange, now: string): Promise<LedgerLocalRows> {
  const table = rows[ROW_KEY[change.entity]] as unknown as Array<{ id: string; updated_at?: string | null } & Record<string, unknown>>;
  const existing = table.find((row) => row.id === change.id) ?? null;

  if (change.op === "CREATE" && existing) return rows; // saved already (a repeated tap or retry)

  let payload: Record<string, unknown>;
  if (change.op === "DELETE") {
    const invalid = validateLedgerChange(rows, change, null, dailyBudgetToday());
    if (invalid) throw new LocalMutationError(invalid);
    if (!existing) return rows;
    payload = { id: change.id };
  } else {
    if (change.op === "UPDATE" && !existing) throw new LocalMutationError("This record no longer exists.");
    const source = change.op === "UPDATE" ? { ...existing, ...change.payload } : change.payload;
    const normalized = LEDGER_NORMALIZERS[change.entity](source as Record<string, unknown>);
    if (!normalized.ok) throw new LocalMutationError(normalized.error);
    const invalid = validateLedgerChange(rows, change, normalized.columns, dailyBudgetToday());
    if (invalid) throw new LocalMutationError(invalid);
    payload = change.op === "CREATE" ? { ...normalized.columns, created_at: now, updated_at: now } : { ...normalized.columns, updated_at: now };
  }

  const next = overlayLedger(ownerId, rows, rows, [{ entity: change.entity, entityId: change.id, op: change.op, payload }]);
  await enqueue(ownerId, change.entity, change.id, change.op, payload, existing?.updated_at ?? null);
  return next;
}

/** Applies a group of related changes atomically on this device. */
export function applyLedgerChangesLocally(ownerId: string, changes: LedgerChange[]) {
  return offlineDb.transaction("rw", transactionTables(), async () => {
    await requireLedger(ownerId);
    const now = new Date().toISOString();
    let rows = await readLedgerRows(ownerId);
    for (const change of changes) rows = await applyChange(ownerId, rows, change, now);
    await replaceLedgerRows(ownerId, rows);
  });
}

/**
 * Creates the recurring dues that should exist by `today`: one per active member per billing
 * period, never twice (deterministic ids plus the member+period check). Runs on this device, online
 * or offline, and the dues sync like any other change. Returns how many were created.
 */
export function generateRecurringDuesLocally(ownerId: string, today: string) {
  return offlineDb.transaction("rw", transactionTables(), async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.totalsMatch || meta.ledgerAvailable !== true) return 0;
    let rows = await readLedgerRows(ownerId);
    const missing = missingRecurringObligations({ ...rows, today }).slice(0, GENERATION_BATCH);
    if (missing.length === 0) return 0;
    const now = new Date().toISOString();
    let created = 0;
    for (const due of missing) {
      try {
        rows = await applyChange(
          ownerId,
          rows,
          {
            entity: "ledger_obligation",
            op: "CREATE",
            id: due.id,
            payload: {
              person_id: due.personId,
              source: "recurring",
              origin: "generated",
              group_id: due.groupId,
              member_id: due.memberId,
              period_start: due.periodStart,
              title: due.title,
              amount: due.amount,
              due_date: due.dueDate,
              currency: due.currency,
              note: null,
            },
          },
          now
        );
        created += 1;
      } catch (error) {
        if (!(error instanceof LocalMutationError)) throw error;
        // A single invalid due (e.g. its member was just removed) must not block the rest.
      }
    }
    await replaceLedgerRows(ownerId, rows);
    return created;
  });
}

async function localSnapshotReady(ownerId: string) {
  const meta = await offlineDb.syncMeta.get(ownerId);
  return meta?.totalsMatch === true && meta.ledgerAvailable === true;
}

/**
 * Saves one or more related ledger changes.
 *  - Offline, or with changes already queued: on this device, queued for sync (order is kept).
 *  - Online, one change: through the Server Action, so the server validates it immediately.
 *  - Online, several related changes: on this device in one atomic step when the local copy is
 *    ready (so they can never be half-saved), otherwise through the Server Action in order.
 */
export async function mutateLedger(changes: LedgerChange[]): Promise<MutationOutcome> {
  const ownerId = getActiveOwnerId();
  const local = !!ownerId && ((await shouldWriteLocally(ownerId)) || (changes.length > 1 && (await localSnapshotReady(ownerId))));
  if (ownerId && local) {
    try {
      await applyLedgerChangesLocally(ownerId, changes);
    } catch (error) {
      if (error instanceof LocalMutationError) return { success: false, error: error.message, queued: true };
      console.error("Local ledger change failed:", error);
      return { success: false, error: "This change couldn't be saved on this device, so nothing was changed. Try again.", queued: true };
    }
    try {
      notifyOutboxChanged();
    } catch {
      // The next app-open / foreground / online trigger syncs it instead.
    }
    return { success: true, queued: true };
  }

  try {
    const result = await ledgerOperationsAction(changes);
    return { success: result.success, error: result.error, queued: false };
  } catch {
    return { success: false, error: "Couldn't reach the server. Check your connection and try again.", queued: false };
  }
}
