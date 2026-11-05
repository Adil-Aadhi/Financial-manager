/**
 * Reports: date ranges and aggregation. Pure functions (no I/O) so they can
 * be shared by the server page and tested directly.
 */

export const REPORT_PRESETS = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "last-3-months", label: "Last 3 months" },
  { id: "this-year", label: "This year" },
  { id: "custom", label: "Custom" },
] as const;

export type ReportPreset = (typeof REPORT_PRESETS)[number]["id"];

/** Longest custom range accepted, to keep the monthly chart readable. */
export const MAX_CUSTOM_RANGE_DAYS = 366 * 5;

export interface ReportRange {
  preset: ReportPreset;
  /** Inclusive "YYYY-MM-DD" bounds. */
  start: string;
  end: string;
  label: string;
  /** Set when a custom range was invalid and the default was used instead. */
  notice?: string;
}

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function isIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function todayIn(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function formatDay(value: string, withYear: boolean) {
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function formatMonthYear(y: number, m: number, short = false) {
  return new Intl.DateTimeFormat("en-IN", {
    month: short ? "short" : "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function isReportPreset(value: string | undefined): value is ReportPreset {
  return REPORT_PRESETS.some((preset) => preset.id === value);
}

/** Resolve the URL's range params into concrete inclusive dates in the user's time zone. */
export function getReportRange(
  params: { range?: string; from?: string; to?: string },
  timeZone: string,
  now = new Date()
): ReportRange {
  const { y, m } = todayIn(timeZone, now);
  const preset: ReportPreset = isReportPreset(params.range) ? params.range : "this-month";

  if (preset === "custom") {
    if (isIsoDate(params.from) && isIsoDate(params.to)) {
      const [start, end] = params.from <= params.to ? [params.from, params.to] : [params.to, params.from];
      const span = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
      if (span <= MAX_CUSTOM_RANGE_DAYS) {
        const sameYear = start.slice(0, 4) === end.slice(0, 4);
        return {
          preset,
          start,
          end,
          label: `${formatDay(start, !sameYear)} – ${formatDay(end, true)}`,
        };
      }
      return { ...getReportRange({ range: "this-month" }, timeZone, now), notice: "Custom ranges can be up to 5 years." };
    }
    return { ...getReportRange({ range: "this-month" }, timeZone, now), notice: "Choose a valid start and end date." };
  }

  if (preset === "last-month") {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return { preset, start: iso(py, pm, 1), end: iso(py, pm, daysInMonth(py, pm)), label: formatMonthYear(py, pm) };
  }

  if (preset === "last-3-months") {
    const sy = m <= 2 ? y - 1 : y;
    const sm = ((m - 3 + 12) % 12) + 1;
    return {
      preset,
      start: iso(sy, sm, 1),
      end: iso(y, m, daysInMonth(y, m)),
      label: `${formatMonthYear(sy, sm, true)} – ${formatMonthYear(y, m, true)}`,
    };
  }

  if (preset === "this-year") {
    return { preset, start: iso(y, 1, 1), end: iso(y, 12, 31), label: String(y) };
  }

  return { preset, start: iso(y, m, 1), end: iso(y, m, daysInMonth(y, m)), label: formatMonthYear(y, m) };
}

/** Every "YYYY-MM" month that overlaps the range, oldest first. */
export function monthsInRange(start: string, end: string) {
  const months: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

// ----------------------------------------------------------------- data --

export type ReportTxType = "income" | "expense";

/** One pre-aggregated row from get_report_rollup (or the fallback). */
export interface ReportRollupRow {
  account_id: string;
  category_id: string | null;
  type: string;
  /** First day of the month, "YYYY-MM-DD". */
  month: string;
  total: number | string;
  tx_count: number | string;
}

export interface ReportAccountMeta {
  id: string;
  name: string;
  currency: string | null;
  trashed: boolean;
}

export interface ReportCategoryMeta {
  id: string;
  name: string;
  icon: string;
}

export interface CategoryTotal {
  id: string;
  name: string;
  icon: string;
  total: number;
  count: number;
  /** Share of the type's total, 0–100. */
  percent: number;
}

export interface MonthTotal {
  key: string;
  label: string;
  shortLabel: string;
  income: number;
  expense: number;
  net: number;
}

export interface AccountTotal {
  id: string;
  name: string;
  trashed: boolean;
  income: number;
  expense: number;
  net: number;
  count: number;
}

export interface ReportData {
  currency: string;
  /** Every currency with activity in the range (for the switcher). */
  currencies: string[];
  income: number;
  expense: number;
  net: number;
  /** Net as a share of income; null when there is no income. */
  savingsRate: number | null;
  count: number;
  expenseCategories: CategoryTotal[];
  incomeCategories: CategoryTotal[];
  months: MonthTotal[];
  accounts: AccountTotal[];
}

const cents = (value: number) => Math.round(value * 100) / 100;

function rankCategories(map: Map<string, Omit<CategoryTotal, "percent">>, total: number): CategoryTotal[] {
  return [...map.values()]
    .map((item) => ({
      ...item,
      total: cents(item.total),
      percent: total > 0 ? (item.total / total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/**
 * Build every report section from rollup rows for ONE currency.
 * Rows from accounts in other currencies are excluded (never converted).
 */
export function buildReport(
  rows: ReportRollupRow[],
  accounts: ReportAccountMeta[],
  categories: ReportCategoryMeta[],
  range: Pick<ReportRange, "start" | "end">,
  requestedCurrency: string | undefined,
  defaultCurrency: string
): ReportData {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const currencyOf = (accountId: string) => accountById.get(accountId)?.currency || defaultCurrency;

  const currencies = [...new Set(rows.map((row) => currencyOf(row.account_id)))].sort();
  const currency =
    requestedCurrency && currencies.includes(requestedCurrency)
      ? requestedCurrency
      : currencies.includes(defaultCurrency) || currencies.length === 0
        ? defaultCurrency
        : currencies[0];

  const monthKeys = monthsInRange(range.start, range.end);
  const monthMap = new Map(monthKeys.map((key) => [key, { income: 0, expense: 0 }]));
  const expenseMap = new Map<string, Omit<CategoryTotal, "percent">>();
  const incomeMap = new Map<string, Omit<CategoryTotal, "percent">>();
  const accountMap = new Map<string, AccountTotal>();
  let income = 0;
  let expense = 0;
  let count = 0;

  for (const row of rows) {
    if (row.type !== "income" && row.type !== "expense") continue;
    if (currencyOf(row.account_id) !== currency) continue;

    const amount = Number(row.total) || 0;
    const rowCount = Number(row.tx_count) || 0;
    const isIncome = row.type === "income";
    count += rowCount;
    if (isIncome) income += amount;
    else expense += amount;

    const month = monthMap.get(row.month.slice(0, 7));
    if (month) {
      if (isIncome) month.income += amount;
      else month.expense += amount;
    }

    const categoryKey = row.category_id ?? "uncategorized";
    const category = row.category_id ? categoryById.get(row.category_id) : undefined;
    const target = isIncome ? incomeMap : expenseMap;
    const entry = target.get(categoryKey) ?? {
      id: categoryKey,
      name: category?.name ?? "Uncategorized",
      icon: category?.icon ?? "circle-ellipsis",
      total: 0,
      count: 0,
    };
    entry.total += amount;
    entry.count += rowCount;
    target.set(categoryKey, entry);

    const accountMeta = accountById.get(row.account_id);
    const accountEntry = accountMap.get(row.account_id) ?? {
      id: row.account_id,
      name: accountMeta?.name ?? "Deleted account",
      trashed: accountMeta?.trashed ?? false,
      income: 0,
      expense: 0,
      net: 0,
      count: 0,
    };
    if (isIncome) accountEntry.income += amount;
    else accountEntry.expense += amount;
    accountEntry.count += rowCount;
    accountMap.set(row.account_id, accountEntry);
  }

  income = cents(income);
  expense = cents(expense);
  const net = cents(income - expense);

  return {
    currency,
    currencies: currencies.length ? currencies : [defaultCurrency],
    income,
    expense,
    net,
    savingsRate: income > 0 ? (net / income) * 100 : null,
    count,
    expenseCategories: rankCategories(expenseMap, expense),
    incomeCategories: rankCategories(incomeMap, income),
    months: monthKeys.map((key) => {
      const [y, m] = key.split("-").map(Number);
      const totals = monthMap.get(key) ?? { income: 0, expense: 0 };
      const date = new Date(Date.UTC(y, m - 1, 1));
      return {
        key,
        label: new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(date),
        shortLabel: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(date),
        income: cents(totals.income),
        expense: cents(totals.expense),
        net: cents(totals.income - totals.expense),
      };
    }),
    accounts: [...accountMap.values()]
      .map((account) => ({
        ...account,
        income: cents(account.income),
        expense: cents(account.expense),
        net: cents(account.income - account.expense),
      }))
      .sort((a, b) => Number(a.trashed) - Number(b.trashed) || b.income + b.expense - (a.income + a.expense)),
  };
}
