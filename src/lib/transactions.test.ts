import { describe, expect, it } from "vitest";
import {
  isAmbiguousLegacyTransactionDateUpdate,
  isTransactionDateChange,
  normalizeTransactionDate,
  transactionDateTimeDefaults,
  transactionDateRangeBounds,
  transactionSortValue,
  type TransactionRecord,
} from "@/lib/transactions";

describe("India calendar transaction dates", () => {
  it("keeps date-only form values unchanged", () => {
    expect(normalizeTransactionDate("2025-04-01")).toBe("2025-04-01");
  });

  it("maps midnight IST returned in UTC back to April 1", () => {
    expect(normalizeTransactionDate("2025-03-31T18:30:00+00:00")).toBe("2025-04-01");
    expect(normalizeTransactionDate("2025-03-31 18:30:00+00")).toBe("2025-04-01");
    expect(normalizeTransactionDate("2025-03-31T18:30:00+0000")).toBe("2025-04-01");
  });

  it("handles month and year boundaries in India", () => {
    expect(normalizeTransactionDate("2025-04-30T18:30:00Z")).toBe("2025-05-01");
    expect(normalizeTransactionDate("2025-12-31T18:30:00Z")).toBe("2026-01-01");
  });

  it("does not shift newly-created UTC-midnight records", () => {
    expect(normalizeTransactionDate("2025-04-01T00:00:00+00:00")).toBe("2025-04-01");
  });

  it("uses the same date-change decision for online and offline edits", () => {
    expect(
      isTransactionDateChange("2025-03-31T18:30:00+00:00", "2025-04-01")
    ).toBe(false);
    expect(
      isTransactionDateChange("2025-03-31T18:30:00+00:00", "2025-04-02")
    ).toBe(true);
    expect(isTransactionDateChange("invalid", "2025-04-01")).toBe(true);
  });

  it("uses India-midnight instants for inclusive Supabase report bounds", () => {
    expect(transactionDateRangeBounds("2025-04-01", "2025-04-30")).toEqual({
      startInclusive: "2025-03-31T18:30:00.000Z",
      endExclusive: "2025-04-30T18:30:00.000Z",
    });
    expect(transactionDateRangeBounds("2025-12-31", "2025-12-31")).toEqual({
      startInclusive: "2025-12-30T18:30:00.000Z",
      endExclusive: "2025-12-31T18:30:00.000Z",
    });
  });

  it("sorts timestamp-backed and date-only records by their intended date", () => {
    const base = {
      account_id: "account",
      category_id: "category",
      type: "expense",
      amount: 1,
      description: null,
      transaction_time: null,
      created_at: "2025-04-01T00:00:00Z",
    } as const;
    const imported = {
      ...base,
      id: "imported",
      transaction_date: "2025-03-31T18:30:00+00:00",
    } satisfies TransactionRecord;
    const previousDay = {
      ...base,
      id: "previous",
      transaction_date: "2025-03-31",
    } satisfies TransactionRecord;

    expect(transactionSortValue(imported) > transactionSortValue(previousDay)).toBe(true);
  });

  it("rejects invalid calendar dates", () => {
    expect(normalizeTransactionDate("2025-02-29")).toBeNull();
    expect(normalizeTransactionDate("2025-04-01garbage")).toBeNull();
    expect(normalizeTransactionDate("not-a-date")).toBeNull();
    expect(transactionDateRangeBounds("2025-02-29", "2025-03-01")).toBeNull();
  });

  it("identifies only the ambiguous old previous-day update pattern", () => {
    expect(
      isAmbiguousLegacyTransactionDateUpdate(
        "2025-03-31T18:30:00+00:00",
        "2025-03-31"
      )
    ).toBe(true);
    expect(
      isAmbiguousLegacyTransactionDateUpdate(
        "2025-03-31T18:30:00+00:00",
        "2025-04-02"
      )
    ).toBe(false);
    expect(
      isAmbiguousLegacyTransactionDateUpdate("2025-04-01", "2025-03-31")
    ).toBe(false);
  });

  it("uses India for both quick-entry date and time", () => {
    expect(
      transactionDateTimeDefaults(new Date("2025-03-31T18:45:00.000Z"))
    ).toEqual({ date: "2025-04-01", time: "00:15" });
    expect(
      transactionDateTimeDefaults(new Date("2025-12-31T18:35:00.000Z"))
    ).toEqual({ date: "2026-01-01", time: "00:05" });
  });
});
