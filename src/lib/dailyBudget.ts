import { TRANSACTION_DATE_TIME_ZONE, transactionDateTimeDefaults } from "@/lib/transactions";

/**
 * Daily Budget Tracker: the calculation engine. Pure functions shared by the server, the
 * offline store and the UI, so every path derives exactly the same balances.
 *
 * Nothing here reads accounts, transactions, categories or the monthly budget. The only
 * inputs are the user's limit history and their manually recorded daily-budget expenses.
 *
 * Rules
 * - allowance(day) = amount of the latest limit whose effective_date <= day; days before the
 *   first limit have no allowance (tracking has not started).
 * - closing(day) = opening(day) + allowance(day) - expenses(day), opening(day) = closing of the
 *   previous day in the same month; the first day of every month opens at 0.
 * - Allowances are derived from calendar dates, never accrued by a job, so they can't be added
 *   twice and the result is the same offline or after days away.
 * - A month is calculated only from its own days, so editing an old month never changes
 *   another month.
 * - Money is summed in integer paise/cents to avoid floating-point drift.
 * - Every date is a calendar date (YYYY-MM-DD) in India (Asia/Kolkata), like transactions.
 */

export const DAILY_BUDGET_TIME_ZONE = TRANSACTION_DATE_TIME_ZONE;
/** Largest amount the database accepts (numeric(14,2)). */
export const MAX_DAILY_BUDGET_AMOUNT = 999_999_999_999.99;
export const MAX_DAILY_EXPENSE_DESCRIPTION = 120;
const MIN_DATE = "2000-01-01";
/** A limit change may be scheduled up to a year ahead. */
const MAX_LIMIT_DAYS_AHEAD = 366;

export interface DailyLimitRecord {
  effective_date: string;
  amount: number | string;
}

export interface DailyExpenseRecord {
  id: string;
  expense_date: string;
  amount: number | string;
  description: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DailyBudgetDay {
  date: string;
  /** false before the first limit's effective date (no allowance yet). */
  tracked: boolean;
  allowance: number;
  expenses: number;
  expenseCount: number;
  /** Balance carried in from the previous day of the same month (0 on the 1st). */
  opening: number;
  closing: number;
}

export interface DailyBudgetMonthTotals {
  allowance: number;
  expenses: number;
  /** Month-end (or so-far) closing balance. */
  closing: number;
  /** The closing balance when it is positive, else 0. */
  saved: number;
  /** How far below zero the closing balance is, else 0. */
  overspent: number;
  /** Days on which spending was above that day's allowance. */
  daysOver: number;
}

export interface DailyBudgetMonth {
  /** "YYYY-MM" */
  month: string;
  label: string;
  /** Oldest first. Empty when nothing is tracked or recorded in this month yet. */
  days: DailyBudgetDay[];
  totals: DailyBudgetMonthTotals;
  /** The month has finished (it is before today's month). */
  closed: boolean;
}

export interface DailyBudgetToday {
  date: string;
  month: string;
  /** Tracking has started on or before today. */
  started: boolean;
  allowance: number;
  expenses: number;
  /** Carried in from earlier days this month. */
  carried: number;
  /** Available balance today (after today's expenses). */
  available: number;
}

/* ------------------------------------------------------------------ dates */

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

export function isMonthKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = MONTH_KEY.exec(value);
  return !!match && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

/** Today's calendar date in India. */
export function dailyBudgetToday(now = new Date()) {
  return transactionDateTimeDefaults(now).date;
}

export function monthOfDate(date: string) {
  return date.slice(0, 7);
}

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function addMonths(month: string, months: number) {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value - 1 + months, 1)).toISOString().slice(0, 7);
}

export function monthFirstDay(month: string) {
  return `${month}-01`;
}

export function monthLastDay(month: string) {
  return addDays(monthFirstDay(addMonths(month, 1)), -1);
}

export function formatMonthLabel(month: string) {
  const [year, value] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, value - 1, 1))
  );
}

/** e.g. "Thu, 5 Nov" (or "Thu, 5 Nov 2025" with the year). */
export function formatDayLabel(date: string, withYear = false) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/* ------------------------------------------------------------------ money */

export function toCents(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

const fromCents = (cents: number) => cents / 100;

/** Rounds to 2 decimals the same way the database stores numeric(14,2). */
export function roundAmount(value: number) {
  return Math.round(value * 100) / 100;
}

/* ------------------------------------------------------------------ limits */

/** Limit history, oldest first, with one entry per date and amounts in cents. */
export function normalizeLimits(limits: DailyLimitRecord[]) {
  const byDate = new Map<string, number>();
  for (const limit of limits) {
    if (isDateKey(limit.effective_date)) byDate.set(limit.effective_date, toCents(limit.amount));
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, cents]) => ({ date, cents }));
}

type SortedLimits = ReturnType<typeof normalizeLimits>;

/** The allowance (cents) for one date, or null before tracking starts. */
function allowanceCentsOn(sorted: SortedLimits, date: string) {
  let current: number | null = null;
  for (const limit of sorted) {
    if (limit.date > date) break;
    current = limit.cents;
  }
  return current;
}

/** The limit in force on `date` (the current limit when date is today). */
export function limitOn(limits: DailyLimitRecord[], date: string) {
  const cents = allowanceCentsOn(normalizeLimits(limits), date);
  return cents === null ? null : fromCents(cents);
}

/** When tracking starts: the earliest effective date, or null before setup. */
export function trackingStartDate(limits: DailyLimitRecord[]) {
  return normalizeLimits(limits)[0]?.date ?? null;
}

/* ------------------------------------------------------------------ calculation */

/**
 * The daily breakdown and totals for one month, derived only from that month's dates.
 * Days run from the 1st (or from the first tracked/recorded day) up to today for the current
 * month, or the month end for past months. Future months have no days.
 */
export function calculateDailyBudgetMonth(
  limits: DailyLimitRecord[],
  expenses: DailyExpenseRecord[],
  month: string,
  today: string
): DailyBudgetMonth {
  const sorted = normalizeLimits(limits);
  const first = monthFirstDay(month);
  const last = monthLastDay(month);

  const expenseCentsByDate = new Map<string, { cents: number; count: number }>();
  let latestExpense: string | null = null;
  let earliestExpense: string | null = null;
  for (const expense of expenses) {
    if (!isDateKey(expense.expense_date) || monthOfDate(expense.expense_date) !== month) continue;
    const entry = expenseCentsByDate.get(expense.expense_date) ?? { cents: 0, count: 0 };
    entry.cents += toCents(expense.amount);
    entry.count += 1;
    expenseCentsByDate.set(expense.expense_date, entry);
    if (!latestExpense || expense.expense_date > latestExpense) latestExpense = expense.expense_date;
    if (!earliestExpense || expense.expense_date < earliestExpense) earliestExpense = expense.expense_date;
  }

  // Never accrue days that haven't happened yet. An expense dated later than today (only
  // possible with a wrong device clock) still counts, so totals always include every entry.
  let end = today < last ? today : last;
  if (latestExpense && latestExpense > end) end = latestExpense;

  const trackingStart = sorted[0]?.date ?? null;
  const candidates = [
    trackingStart !== null && trackingStart <= last ? (trackingStart < first ? first : trackingStart) : null,
    earliestExpense,
  ].filter((value): value is string => value !== null);
  const start = candidates.length ? candidates.sort()[0] : null;

  const days: DailyBudgetDay[] = [];
  let balance = 0;
  let allowanceTotal = 0;
  let expenseTotal = 0;
  let daysOver = 0;

  if (start && start <= end) {
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const allowanceCents = allowanceCentsOn(sorted, date);
      const spent = expenseCentsByDate.get(date) ?? { cents: 0, count: 0 };
      const allowance = allowanceCents ?? 0;
      const opening = balance;
      balance = opening + allowance - spent.cents;
      allowanceTotal += allowance;
      expenseTotal += spent.cents;
      if (spent.cents > allowance) daysOver += 1;
      days.push({
        date,
        tracked: allowanceCents !== null,
        allowance: fromCents(allowance),
        expenses: fromCents(spent.cents),
        expenseCount: spent.count,
        opening: fromCents(opening),
        closing: fromCents(balance),
      });
    }
  }

  return {
    month,
    label: formatMonthLabel(month),
    days,
    totals: {
      allowance: fromCents(allowanceTotal),
      expenses: fromCents(expenseTotal),
      closing: fromCents(balance),
      saved: fromCents(Math.max(0, balance)),
      overspent: fromCents(Math.max(0, -balance)),
      daysOver,
    },
    closed: month < monthOfDate(today),
  };
}

/** Today's figures for the Home card and the page overview. */
export function calculateDailyBudgetToday(
  limits: DailyLimitRecord[],
  expenses: DailyExpenseRecord[],
  today: string
): DailyBudgetToday {
  const month = monthOfDate(today);
  const result = calculateDailyBudgetMonth(limits, expenses, month, today);
  const day = result.days.find((entry) => entry.date === today);
  return {
    date: today,
    month,
    started: limitOn(limits, today) !== null,
    allowance: day?.allowance ?? 0,
    expenses: day?.expenses ?? 0,
    carried: day?.opening ?? 0,
    available: day?.closing ?? 0,
  };
}

/** Months that have any limit or expense, plus the current month, newest first. */
export function dailyBudgetMonths(
  limits: DailyLimitRecord[],
  expenses: DailyExpenseRecord[],
  today: string
) {
  const current = monthOfDate(today);
  const start = trackingStartDate(limits);
  let earliest = current;
  if (start && monthOfDate(start) < earliest) earliest = monthOfDate(start);
  for (const expense of expenses) {
    if (isDateKey(expense.expense_date) && monthOfDate(expense.expense_date) < earliest) {
      earliest = monthOfDate(expense.expense_date);
    }
  }
  const months: string[] = [];
  for (let month = current; month >= earliest; month = addMonths(month, -1)) months.push(month);
  return months;
}

/** A month's expenses grouped by date, newest date first and newest entry first. */
export function groupExpensesByDate<T extends DailyExpenseRecord>(expenses: T[], month: string) {
  const groups = new Map<string, T[]>();
  for (const expense of expenses) {
    if (monthOfDate(expense.expense_date) !== month) continue;
    const list = groups.get(expense.expense_date) ?? [];
    list.push(expense);
    groups.set(expense.expense_date, list);
  }
  for (const list of groups.values()) {
    list.sort((left, right) => (right.created_at ?? "").localeCompare(left.created_at ?? ""));
  }
  return groups;
}

/* ------------------------------------------------------------------ validation */

export interface DailyExpenseInput {
  amount: number;
  expenseDate: string;
  description: string;
}

export interface DailyLimitInput {
  amount: number;
  effectiveDate: string;
}

function amountError(value: number, allowZero: boolean) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a valid amount.";
  if (allowZero ? value < 0 : value <= 0) {
    return allowZero ? "The daily limit can't be negative." : "Amount must be greater than zero.";
  }
  if (value > MAX_DAILY_BUDGET_AMOUNT) return "That amount is too large.";
  if (Math.abs(roundAmount(value) - value) > 1e-9) return "Use at most two decimal places.";
  return null;
}

/** Same rules on the device and on the server. `today` is India's calendar date. */
export function validateDailyExpenseInput(input: DailyExpenseInput, today: string) {
  const amount = amountError(input.amount, false);
  if (amount) return amount;
  if (!isDateKey(input.expenseDate) || input.expenseDate < MIN_DATE) return "Choose a valid date.";
  if (input.expenseDate > today) return "Expenses can't be dated in the future.";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description) return "Add a short description.";
  if (description.length > MAX_DAILY_EXPENSE_DESCRIPTION) {
    return `Keep the description under ${MAX_DAILY_EXPENSE_DESCRIPTION} characters.`;
  }
  return null;
}

export function validateDailyLimitInput(input: DailyLimitInput, today: string) {
  const amount = amountError(input.amount, true);
  if (amount) return amount;
  if (!isDateKey(input.effectiveDate) || input.effectiveDate < MIN_DATE) return "Choose a valid date.";
  if (input.effectiveDate > addDays(today, MAX_LIMIT_DAYS_AHEAD)) {
    return "Choose a start date within the next year.";
  }
  return null;
}
