/**
 * Account groups: two fixed buckets stored in `public.accounts.account_group`
 * (text, NOT NULL, default 'general', check constraint accounts_account_group_check).
 *
 * Shared by the server actions, the sync apply step, the offline store and the UI so every
 * path agrees on the allowed values and on how a missing value is read.
 */

export const ACCOUNT_GROUPS = ["primary", "general"] as const;
export type AccountGroup = (typeof ACCOUNT_GROUPS)[number];

/** Accounts created in the app start in Primary. */
export const DEFAULT_NEW_ACCOUNT_GROUP: AccountGroup = "primary";
/** Rows saved before groups existed (and the database default) are General. */
export const LEGACY_ACCOUNT_GROUP: AccountGroup = "general";

export const ACCOUNT_GROUP_LABELS: Record<AccountGroup, string> = {
  primary: "Primary",
  general: "General",
};

export function isAccountGroup(value: unknown): value is AccountGroup {
  return value === "primary" || value === "general";
}

/**
 * Reads a stored group. Anything that is not a valid group (an old cached row with no value)
 * is General, so every account always belongs to exactly one of the two tabs.
 */
export function normalizeAccountGroup(value: unknown): AccountGroup {
  return isAccountGroup(value) ? value : LEGACY_ACCOUNT_GROUP;
}

// Backward-compatible re-export. Runtime consumers import the dependency-free
// account-summary module directly so client and server bundles share one module.
export {
  changedIncludeInSummary,
  normalizeIncludeInSummary,
} from "@/lib/accountSummary";

export const ACCOUNT_GROUP_ERROR = "Choose Primary or General for this account.";

// ------------------------------------------------------------------ archive --

/**
 * Archived accounts (accounts.archived_at) are hidden from the Transactions page and can't take
 * new transactions. Their balance and history still count on Home, Reports and exports.
 * Missing on rows saved before the archive migration = not archived.
 */
export function isAccountArchived(account: { archived_at?: string | null } | null | undefined) {
  return Boolean(account?.archived_at);
}

export const ARCHIVED_ACCOUNT_ERROR = "This account is archived. Unarchive it to add transactions.";

/**
 * Whether a transaction may be saved to this account: an unarchived account always, an archived
 * one only when the transaction already belonged to it (editing existing history is allowed).
 */
export function archivedAccountBlocks(
  account: { id: string; archived_at?: string | null },
  existingAccountId?: string | null
) {
  return isAccountArchived(account) && account.id !== existingAccountId;
}
