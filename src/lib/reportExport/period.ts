/**
 * Reporting periods for exports. Pure functions: every period resolves to inclusive
 * "YYYY-MM-DD" bounds in the transaction calendar (India), the same calendar the Reports
 * page and every balance use. `null` bounds mean "open" (All time).
 */

import { getReportRange } from "@/lib/reports";
import { TRANSACTION_CALENDAR_TIME_ZONE } from "@/lib/month";

export type ExportPeriod =
  | { kind: "current-month" }
  | { kind: "last-3-months" }
  | { kind: "month"; year: number; month: number }
  | { kind: "current-year" }
  | { kind: "year"; year: number }
  | { kind: "custom"; start: string; end: string }
  | { kind: "all-time" };

export type ExportPeriodKind = ExportPeriod["kind"];

export const EXPORT_PERIOD_OPTIONS: { id: ExportPeriodKind; label: string }[] = [
  { id: "current-month", label: "Current month" },
  { id: "last-3-months", label: "Last 3 months" },
  { id: "month", label: "Specific month" },
  { id: "current-year", label: "Current year" },
  { id: "year", label: "Specific year" },
  { id: "custom", label: "Custom range" },
  { id: "all-time", label: "All time" },
];

export interface ResolvedPeriod {
  kind: ExportPeriodKind;
  /** Inclusive first day, or null for All time. */
  start: string | null;
  /** Inclusive last day, or null for All time (includes future-dated entries). */
  end: string | null;
  /** Human label, e.g. "November 2026". */
  label: string;
  /** Filename-safe stem, e.g. "2026-11". */
  fileStem: string;
}

export type PeriodResult = { ok: true; period: ResolvedPeriod } | { ok: false; error: string };

export const MIN_EXPORT_YEAR = 1990;
export const MAX_EXPORT_YEAR = 2100;

const pad = (value: number) => String(value).padStart(2, "0");
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Today's calendar date in the transaction time zone. */
export function exportToday(now = new Date(), timeZone = TRANSACTION_CALENDAR_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function monthLabel(y: number, m: number) {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1))
  );
}

export function formatExportDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The day before an ISO date (for "balance immediately before the period"). */
export function dayBefore(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

function validYear(year: number) {
  return Number.isInteger(year) && year >= MIN_EXPORT_YEAR && year <= MAX_EXPORT_YEAR;
}

/**
 * Resolve a period selection into concrete inclusive bounds. Invalid selections return an
 * error instead of silently falling back to another range.
 */
export function resolveExportPeriod(
  period: ExportPeriod,
  now = new Date(),
  timeZone = TRANSACTION_CALENDAR_TIME_ZONE
): PeriodResult {
  switch (period.kind) {
    case "current-month":
    case "last-3-months":
    case "current-year": {
      // Same definitions as the Reports page filters.
      const preset =
        period.kind === "current-month"
          ? "this-month"
          : period.kind === "last-3-months"
            ? "last-3-months"
            : "this-year";
      const range = getReportRange({ range: preset }, timeZone, now);
      const fileStem =
        period.kind === "current-month"
          ? range.start.slice(0, 7)
          : period.kind === "current-year"
            ? range.start.slice(0, 4)
            : `${range.start.slice(0, 7)}_to_${range.end.slice(0, 7)}`;
      return {
        ok: true,
        period: { kind: period.kind, start: range.start, end: range.end, label: range.label, fileStem },
      };
    }
    case "month": {
      const { year, month } = period;
      if (!validYear(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        return { ok: false, error: "Choose a valid month and year." };
      }
      return {
        ok: true,
        period: {
          kind: "month",
          start: `${year}-${pad(month)}-01`,
          end: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`,
          label: monthLabel(year, month),
          fileStem: `${year}-${pad(month)}`,
        },
      };
    }
    case "year": {
      if (!validYear(period.year)) return { ok: false, error: "Choose a valid year." };
      return {
        ok: true,
        period: {
          kind: "year",
          start: `${period.year}-01-01`,
          end: `${period.year}-12-31`,
          label: String(period.year),
          fileStem: String(period.year),
        },
      };
    }
    case "custom": {
      const { start, end } = period;
      if (!isIsoDate(start) || !isIsoDate(end)) {
        return { ok: false, error: "Choose a valid start and end date." };
      }
      if (start > end) return { ok: false, error: "The start date can't be after the end date." };
      if (!validYear(Number(start.slice(0, 4))) || !validYear(Number(end.slice(0, 4)))) {
        return { ok: false, error: `Dates must be between ${MIN_EXPORT_YEAR} and ${MAX_EXPORT_YEAR}.` };
      }
      return {
        ok: true,
        period: {
          kind: "custom",
          start,
          end,
          label: start === end ? formatExportDate(start) : `${formatExportDate(start)} – ${formatExportDate(end)}`,
          fileStem: start === end ? start : `${start}_to_${end}`,
        },
      };
    }
    case "all-time":
      return {
        ok: true,
        period: { kind: "all-time", start: null, end: null, label: "All time", fileStem: "All_Time" },
      };
  }
}

/** Inclusive membership test on calendar dates; open bounds always match. */
export function dateInPeriod(date: string, period: Pick<ResolvedPeriod, "start" | "end">) {
  if (period.start && date < period.start) return false;
  if (period.end && date > period.end) return false;
  return true;
}
