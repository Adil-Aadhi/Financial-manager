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

export const ACCOUNT_GROUP_ERROR = "Choose Primary or General for this account.";
