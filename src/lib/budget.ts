/** Largest limit the database accepts (numeric(14,2)). */
export const MAX_BUDGET_AMOUNT = 999_999_999_999.99;

export type BudgetLevel = "within" | "approaching" | "most" | "exceeded";

export interface BudgetStatus {
  /** Percentage of the limit used, unrounded (can exceed 100). */
  percentUsed: number;
  /** Money still available; never negative. */
  remaining: number;
  /** Amount spent above the limit; 0 when within budget. */
  exceededBy: number;
  level: BudgetLevel;
  message: string;
}

export const BUDGET_MESSAGES: Record<BudgetLevel, string> = {
  within: "You're within your monthly budget.",
  approaching: "You're approaching your monthly budget.",
  most: "You've used most of your monthly budget.",
  exceeded: "You've exceeded your monthly budget.",
};

/** Thresholds: <75% within · 75–89.99% approaching · 90–99.99% most · ≥100% exceeded. */
export function getBudgetStatus(spent: number, limit: number): BudgetStatus {
  const safeSpent = Math.max(0, spent);
  const percentUsed = limit > 0 ? (safeSpent / limit) * 100 : 0;

  // Compare in cents so float noise never flips a threshold.
  const spentCents = Math.round(safeSpent * 100);
  const limitCents = Math.round(limit * 100);

  let level: BudgetLevel;
  if (spentCents >= limitCents) level = "exceeded";
  else if (spentCents * 100 >= limitCents * 90) level = "most";
  else if (spentCents * 100 >= limitCents * 75) level = "approaching";
  else level = "within";

  return {
    percentUsed,
    remaining: Math.max(0, (limitCents - spentCents) / 100),
    exceededBy: Math.max(0, (spentCents - limitCents) / 100),
    level,
    message: BUDGET_MESSAGES[level],
  };
}

const PERCENT_THRESHOLDS = [75, 90, 100];

/**
 * "66.7%": one decimal, trailing ".0" dropped. Never rounds up onto a status
 * threshold (74.99% shows "74.9%", not "75%"), so the label matches the message.
 */
export function formatPercent(value: number) {
  let rounded = Math.round(value * 10) / 10;
  for (const threshold of PERCENT_THRESHOLDS) {
    if (value < threshold && rounded >= threshold) rounded = threshold - 0.1;
  }
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

/** Validates a budget amount; returns an error message or null. */
export function validateBudgetAmount(value: number) {
  if (!Number.isFinite(value)) return "Enter a valid amount.";
  if (value <= 0) return "Budget must be greater than zero.";
  if (value > MAX_BUDGET_AMOUNT) return "That amount is too large.";
  return null;
}
