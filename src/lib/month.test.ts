import { describe, expect, it } from "vitest";
import {
  TRANSACTION_CALENDAR_TIME_ZONE,
  getRecentMonthKeys,
  getTransactionMonthRange,
} from "@/lib/month";
import { getReportRange } from "@/lib/reports";

describe("India transaction month boundaries", () => {
  it("allocates an instant after India midnight to April on every device", () => {
    const now = new Date("2025-03-31T20:00:00.000Z");
    expect(getTransactionMonthRange(now)).toMatchObject({
      prefix: "2025-04",
      start: "2025-04-01",
      end: "2025-05-01",
    });
    expect(
      getReportRange({ range: "this-month" }, TRANSACTION_CALENDAR_TIME_ZONE, now)
    ).toMatchObject({ start: "2025-04-01", end: "2025-04-30" });
  });

  it("handles the India year boundary consistently", () => {
    const now = new Date("2025-12-31T19:00:00.000Z");
    expect(getTransactionMonthRange(now)).toMatchObject({
      prefix: "2026-01",
      start: "2026-01-01",
      end: "2026-02-01",
    });
    expect(
      getReportRange({ range: "this-year" }, TRANSACTION_CALENDAR_TIME_ZONE, now)
    ).toMatchObject({ start: "2026-01-01", end: "2026-12-31" });
  });

  it("calculates rolling recent month keys correctly across years", () => {
    expect(getRecentMonthKeys("2026-11", 6)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);

    expect(getRecentMonthKeys("2026-03", 6)).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });
});
