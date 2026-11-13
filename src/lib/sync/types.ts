import type { LedgerEntity } from "@/lib/ledger";

/** Wire types shared by the client sync engine and the sync Server Action. */

export type SyncEntity =
  | LedgerEntity
  | "transaction"
  | "account"
  | "category"
  | "budget"
  | "daily_expense"
  | "daily_limit"
  | "subscription"
  | "subscription_payment"
  | "bill"
  | "bill_payment"
  | "installment_plan"
  | "installment_payment";
export type SyncOp = "CREATE" | "UPDATE" | "DELETE";
export type TransactionDateIntent = "unchanged" | "changed";
export type SyncReviewReason = "legacy-transaction-date";

/** One outbox entry as sent to the server. */
export interface SyncOperation {
  opId: string;
  seq: number;
  ownerId: string;
  entity: SyncEntity;
  entityId: string;
  op: SyncOp;
  payload: Record<string, unknown>;
  /** Present on transaction updates created by date-aware clients. */
  transactionDateIntent?: TransactionDateIntent;
  /** Server updated_at the device last saw before editing (null for records created offline). */
  baseUpdatedAt: string | null;
  /** When the user last made this change on the device (outbox entry updatedAt). */
  editedAt: string;
}

/**
 * applied          the server wrote the change
 * already-applied  the server already had it (a retry of a change that went through)
 * rejected         a rule, permission or data problem; needs the user (never retried automatically)
 * retry            temporary problem (network, database unavailable); safe to send again
 */
export type SyncResultStatus = "applied" | "already-applied" | "rejected" | "retry";

export interface SyncConflict {
  /** kept-local: this device's later edit was applied. kept-server: a later edit made elsewhere was kept. */
  outcome: "kept-local" | "kept-server";
  serverUpdatedAt: string;
  clientEditedAt: string;
}

export interface SyncOpResult {
  opId: string;
  status: SyncResultStatus;
  error?: string;
  /** A durable user review is required before this operation can be retried safely. */
  reviewReason?: SyncReviewReason;
  /** Current server value used to restore the local date while an old edit is reviewed. */
  serverTransactionDate?: string;
  conflict?: SyncConflict;
  /** The record's updated_at on the server after this result, when it has one. */
  serverUpdatedAt?: string | null;
}

export interface SyncBatchResponse {
  /** auth: no valid session. wrong-user: the batch belongs to another user. invalid: malformed batch. */
  status: "ok" | "auth" | "wrong-user" | "invalid";
  results: SyncOpResult[];
  error?: string;
}

export const SYNC_BATCH_SIZE = 25;
