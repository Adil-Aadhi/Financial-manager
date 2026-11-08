import { addDays, dailyBudgetToday, isDateKey, toCents } from "@/lib/dailyBudget";

/** Subscription Tracker domain logic. It has no dependency on financial transactions. */
export const SUBSCRIPTION_CYCLES = ["weekly", "monthly", "quarterly", "half-yearly", "yearly"] as const;
export const SUBSCRIPTION_LIFECYCLES = ["active", "paused", "cancelled"] as const;
export const SUBSCRIPTION_ICON_OPTIONS = [
  { value: "repeat-2", label: "General" },
  { value: "music-2", label: "Music" },
  { value: "film", label: "Movies" },
  { value: "tv", label: "TV & streaming" },
  { value: "bot", label: "AI & GPT" },
  { value: "sparkles", label: "Premium tools" },
  { value: "wrench", label: "Utilities" },
  { value: "cloud", label: "Cloud storage" },
  { value: "gamepad-2", label: "Gaming" },
  { value: "dumbbell", label: "Fitness" },
  { value: "book-open", label: "Education" },
  { value: "newspaper", label: "News" },
  { value: "shopping-bag", label: "Shopping" },
  { value: "wifi", label: "Internet" },
  { value: "smartphone", label: "Mobile" },
  { value: "message-circle", label: "Communication" },
  { value: "briefcase", label: "Work" },
  { value: "palette", label: "Design" },
  { value: "camera", label: "Photos" },
  { value: "headphones", label: "Audio" },
  { value: "podcast", label: "Podcasts" },
  { value: "shield-check", label: "Security" },
  { value: "code-2", label: "Developer tools" },
  { value: "database", label: "Data & hosting" },
  { value: "heart-pulse", label: "Health" },
  { value: "plane", label: "Travel" },
  { value: "car", label: "Transport" },
  { value: "utensils", label: "Food" },
  { value: "house", label: "Home" },
  { value: "zap", label: "Energy" },
] as const;
export const DEFAULT_SUBSCRIPTION_ICON = "repeat-2";
export const MAX_SUBSCRIPTION_AMOUNT = 999_999_999_999.99;
export const MAX_SUBSCRIPTION_NAME = 80;
export const MAX_SUBSCRIPTION_NOTES = 500;

export type BillingCycle = (typeof SUBSCRIPTION_CYCLES)[number];
export type SubscriptionLifecycle = (typeof SUBSCRIPTION_LIFECYCLES)[number];
export type SubscriptionPaymentStatus = "upcoming" | "pending" | "overdue";
export type SubscriptionIconName = (typeof SUBSCRIPTION_ICON_OPTIONS)[number]["value"];

export interface SubscriptionRecord {
  id: string;
  user_id: string;
  name: string;
  icon: SubscriptionIconName;
  amount: number | string;
  currency: string;
  billing_cycle: BillingCycle;
  billing_anchor_day: number;
  start_date: string;
  next_payment_date: string;
  lifecycle: SubscriptionLifecycle;
  notes: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface SubscriptionPaymentRecord {
  id: string;
  user_id: string;
  subscription_id: string;
  due_date: string;
  paid_at: string;
  created_at: string;
  updated_at?: string | null;
}

export interface SubscriptionInput {
  name: string;
  icon: SubscriptionIconName;
  amount: number;
  currency: string;
  billingCycle: BillingCycle;
  nextPaymentDate: string;
  notes: string;
}

export function isBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === "string" && SUBSCRIPTION_CYCLES.includes(value as BillingCycle);
}

export function isSubscriptionIcon(value: unknown): value is SubscriptionIconName {
  return typeof value === "string" && SUBSCRIPTION_ICON_OPTIONS.some((option) => option.value === value);
}

export function isSubscriptionLifecycle(value: unknown): value is SubscriptionLifecycle {
  return typeof value === "string" && SUBSCRIPTION_LIFECYCLES.includes(value as SubscriptionLifecycle);
}

export function cycleLabel(cycle: BillingCycle) {
  return ({
    weekly: "Weekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    "half-yearly": "Half-yearly",
    yearly: "Yearly",
  } as const)[cycle];
}

function dateParts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar-safe cycle movement. anchorDay preserves Jan 31 -> Feb 28 -> Mar 31. */
export function addBillingCycle(date: string, cycle: BillingCycle, anchorDay?: number) {
  if (cycle === "weekly") return addDays(date, 7);
  const months = cycle === "monthly" ? 1 : cycle === "quarterly" ? 3 : cycle === "half-yearly" ? 6 : 12;
  const { year, month, day } = dateParts(date);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12 + 1;
  const targetDay = Math.min(anchorDay ?? day, daysInMonth(targetYear, targetMonth));
  return `${targetYear.toString().padStart(4, "0")}-${targetMonth.toString().padStart(2, "0")}-${targetDay.toString().padStart(2, "0")}`;
}

export function previousBillingDate(date: string, cycle: BillingCycle, anchorDay?: number) {
  if (cycle === "weekly") return addDays(date, -7);
  const months = cycle === "monthly" ? -1 : cycle === "quarterly" ? -3 : cycle === "half-yearly" ? -6 : -12;
  const { year, month, day } = dateParts(date);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12 + 1;
  const targetDay = Math.min(anchorDay ?? day, daysInMonth(targetYear, targetMonth));
  return `${targetYear.toString().padStart(4, "0")}-${targetMonth.toString().padStart(2, "0")}-${targetDay.toString().padStart(2, "0")}`;
}

export function subscriptionToday(now = new Date()) {
  return dailyBudgetToday(now);
}

export function daysBetween(from: string, to: string) {
  const a = dateParts(from);
  const b = dateParts(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

export function subscriptionStatus(subscription: SubscriptionRecord, today: string): SubscriptionPaymentStatus | SubscriptionLifecycle {
  if (subscription.lifecycle !== "active") return subscription.lifecycle;
  if (subscription.next_payment_date < today) return "overdue";
  if (subscription.next_payment_date === today) return "pending";
  return "upcoming";
}

export function daysRemaining(subscription: SubscriptionRecord, today: string) {
  return daysBetween(today, subscription.next_payment_date);
}

export function cycleProgress(subscription: SubscriptionRecord, today: string) {
  const calculatedStart = previousBillingDate(
    subscription.next_payment_date,
    subscription.billing_cycle,
    subscription.billing_anchor_day
  );
  const start = subscription.start_date > calculatedStart ? subscription.start_date : calculatedStart;
  const total = Math.max(1, daysBetween(start, subscription.next_payment_date));
  const elapsed = daysBetween(start, today);
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
}

export function monthlyEquivalent(amount: number | string, cycle: BillingCycle) {
  const value = Number(amount) || 0;
  if (cycle === "weekly") return (value * 52) / 12;
  if (cycle === "quarterly") return value / 3;
  if (cycle === "half-yearly") return value / 6;
  if (cycle === "yearly") return value / 12;
  return value;
}

export function validateSubscriptionInput(input: SubscriptionInput) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return "Subscription name is required.";
  if (name.length > MAX_SUBSCRIPTION_NAME) return `Keep the name under ${MAX_SUBSCRIPTION_NAME} characters.`;
  if (!isSubscriptionIcon(input.icon)) return "Choose a valid subscription icon.";
  if (!Number.isFinite(input.amount) || input.amount <= 0) return "Amount must be greater than zero.";
  if (input.amount > MAX_SUBSCRIPTION_AMOUNT) return "That amount is too large.";
  if (Math.abs(input.amount * 100 - Math.round(input.amount * 100)) > 1e-7) return "Use at most two decimal places.";
  if (!/^[A-Z]{3}$/.test(input.currency)) return "Choose a valid currency.";
  if (!isBillingCycle(input.billingCycle)) return "Choose a supported billing cycle.";
  if (!isDateKey(input.nextPaymentDate) || input.nextPaymentDate < "2000-01-01") return "Choose a valid payment date.";
  if (input.notes.trim().length > MAX_SUBSCRIPTION_NOTES) return `Keep notes under ${MAX_SUBSCRIPTION_NOTES} characters.`;
  return null;
}

export function sameMoney(left: number | string, right: number | string) {
  return toCents(left) === toCents(right);
}

export function formatSubscriptionDate(date: string, withYear = true) {
  const { year, month, day } = dateParts(date);
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
