import type { CategoryType } from "@/lib/categories";

export type TransactionType = CategoryType;

export interface TransactionAccountOption {
  id: string;
  name: string;
  currency: string | null;
}

export interface TransactionCategoryOption {
  id: string;
  name: string;
  type: TransactionType;
  icon: string;
  is_default: boolean;
}

export interface TransactionRecord {
  id: string;
  account_id: string;
  category_id: string;
  type: TransactionType;
  amount: number | string;
  description: string | null;
  transaction_date: string;
  transaction_time: string | null;
  created_at: string;
  updated_at?: string | null;
  category?: {
    id: string;
    name: string;
    icon: string;
  } | null;
}

export interface TransactionFormOptions {
  accounts: TransactionAccountOption[];
  categories: TransactionCategoryOption[];
}

/**
 * transaction_date is a calendar date in India, even when the legacy
 * timestamptz column is returned by PostgREST as a UTC instant.
 */
export const TRANSACTION_DATE_TIME_ZONE = "Asia/Kolkata";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PART = "(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d{1,6})?)?";
const OFFSET_TIMESTAMP = new RegExp(
  `^\\d{4}-\\d{2}-\\d{2}[T ]${TIME_PART}(?:Z|[+-]\\d{2}(?::?\\d{2})?)$`,
  "i"
);
const OFFSETLESS_TIMESTAMP = new RegExp(`^\\d{4}-\\d{2}-\\d{2}[T ]${TIME_PART}$`);

function validDateOnly(value: string) {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const part = (type: "year" | "month" | "day") =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function normalizeTransactionDate(value: string | null | undefined) {
  const input = value?.trim() ?? "";

  // Form values and newly-created offline rows are already date-only. Never
  // reinterpret them as UTC instants, because their characters are the value.
  if (validDateOnly(input)) return input;

  // Supabase serializes timestamptz values with an explicit offset. Convert
  // those instants to the Indian calendar before taking the date.
  if (OFFSET_TIMESTAMP.test(input)) {
    const parseable = input
      .replace(" ", "T")
      .replace(/([+-]\d{2})$/i, "$1:00");
    const instant = new Date(parseable);
    if (!Number.isNaN(instant.getTime())) {
      const normalized = dateKeyInTimeZone(instant, TRANSACTION_DATE_TIME_ZONE);
      return validDateOnly(normalized) ? normalized : null;
    }
    return null;
  }

  // Be conservative with offset-less legacy timestamps: they do not identify
  // an instant, so preserve their leading calendar date instead of letting the
  // runtime's local time zone decide it.
  if (OFFSETLESS_TIMESTAMP.test(input)) {
    const leadingDate = input.slice(0, 10);
    return validDateOnly(leadingDate) ? leadingDate : null;
  }

  // Invalid or unsupported values are explicit. Callers must preserve the raw
  // value, skip it, or show validation rather than silently turning it into a
  // different calendar date.
  return null;
}

export function isTransactionDateChange(
  storedValue: string | null | undefined,
  nextDate: string
) {
  return normalizeTransactionDate(storedValue) !== nextDate;
}

/** True only for the old UI's indistinguishable previous-UTC-day update pattern. */
export function isAmbiguousLegacyTransactionDateUpdate(
  serverValue: unknown,
  queuedValue: unknown
) {
  if (typeof serverValue !== "string" || typeof queuedValue !== "string") return false;
  const queuedDate = normalizeTransactionDate(queuedValue);
  const serverDate = normalizeTransactionDate(serverValue);
  const utcPrefix = serverValue.trim().slice(0, 10);
  return (
    OFFSET_TIMESTAMP.test(serverValue.trim()) &&
    queuedDate !== null &&
    serverDate !== null &&
    queuedDate === utcPrefix &&
    queuedDate !== serverDate
  );
}

/** Date and time defaults from one instant, both in the transaction calendar zone. */
export function transactionDateTimeDefaults(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: TRANSACTION_DATE_TIME_ZONE,
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const time = `${part("hour")}:${part("minute")}`;
  if (!validDateOnly(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new RangeError("Unable to determine the current transaction date and time.");
  }
  return { date, time };
}

function addDateOnlyDays(value: string, days: number) {
  if (!validDateOnly(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function zonedStartOfDayUtc(value: string, timeZone: string) {
  const [year, month, day] = value.split("-").map(Number);
  const desiredUtcWallClock = Date.UTC(year, month - 1, day);
  let instant = desiredUtcWallClock;

  // Resolve the IANA-zone offset at the target boundary. The second pass also
  // makes this safe for zones whose offset differs around a date transition.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(new Date(instant));
    const numberPart = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value);
    const observedUtcWallClock = Date.UTC(
      numberPart("year"),
      numberPart("month") - 1,
      numberPart("day"),
      numberPart("hour"),
      numberPart("minute"),
      numberPart("second")
    );
    instant = desiredUtcWallClock - (observedUtcWallClock - instant);
  }

  return new Date(instant).toISOString();
}

/** Inclusive India calendar-date bounds expressed as UTC instants for Supabase. */
export function transactionDateRangeBounds(start: string, end: string) {
  const normalizedStart = normalizeTransactionDate(start);
  const normalizedEnd = normalizeTransactionDate(end);
  if (!normalizedStart || !normalizedEnd) return null;
  const dayAfterEnd = addDateOnlyDays(normalizedEnd, 1);
  if (!dayAfterEnd) return null;

  return {
    startInclusive: zonedStartOfDayUtc(normalizedStart, TRANSACTION_DATE_TIME_ZONE),
    endExclusive: zonedStartOfDayUtc(dayAfterEnd, TRANSACTION_DATE_TIME_ZONE),
  };
}

export function transactionSortValue(transaction: TransactionRecord) {
  const time = transaction.transaction_time?.slice(0, 8) ?? "00:00:00";
  const date = normalizeTransactionDate(transaction.transaction_date) || "0000-00-00";
  return `${date}T${time}|${transaction.created_at}`;
}
