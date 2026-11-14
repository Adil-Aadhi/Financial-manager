/** Text helpers shared by the exporters (no library dependencies). */

import type { AccountMode, ExportAccount, ExportFormat } from "@/lib/reportExport/model";
import type { ResolvedPeriod } from "@/lib/reportExport/period";

const LOCALE: Record<string, string> = { INR: "en-IN", USD: "en-US", AED: "en-AE" };

/** "1,25,000.00" for INR (Indian grouping), "125,000.00" otherwise. No symbol. */
export function formatAmount(value: number, currency: string) {
  return new Intl.NumberFormat(LOCALE[currency] ?? "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  })
    .format(value)
    .replace(/−/g, "-");
}

/** "INR 1,25,000.00" / "-INR 500.00". Plain ASCII so it renders in every PDF font. */
export function formatMoneyText(value: number, currency: string) {
  const text = `${currency} ${formatAmount(Math.abs(value), currency)}`;
  return value < 0 ? `-${text}` : text;
}

export function formatSignedMoneyText(value: number, currency: string) {
  if (value === 0) return formatMoneyText(0, currency);
  return `${value > 0 ? "+" : "-"}${formatMoneyText(Math.abs(value), currency)}`;
}

/** "2026-11-14" → "14 Nov 2026" */
export function formatDisplayDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d))
  );
}

/** ISO instant → "14 Nov 2026, 15:42" in the given zone. */
export function formatGeneratedAt(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(iso));
}

export function typeLabel(type: "income" | "expense") {
  return type === "income" ? "Income" : "Expense";
}

/**
 * Neutralise spreadsheet formula injection: a text cell that starts with = + - @ or a control
 * character is prefixed with an apostrophe so Excel, Sheets and LibreOffice show it as text.
 */
export function neutralizeFormula(value: string) {
  return /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
}

function safeSegment(value: string, max: number) {
  const ascii = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return ascii.slice(0, max).replace(/_$/, "");
}

/** e.g. Finance_Report_2026-11.pdf, Finance_Report_2026-11_HDFC_Savings.xlsx */
export function buildExportFilename(
  period: Pick<ResolvedPeriod, "fileStem">,
  mode: AccountMode,
  account: Pick<ExportAccount, "name"> | null,
  format: ExportFormat
) {
  const parts = ["Finance_Report", safeSegment(period.fileStem, 40) || "Report"];
  if (mode === "single") parts.push(safeSegment(account?.name ?? "", 40) || "Account");
  if (mode === "separate") parts.push("By_Account");
  return `${parts.join("_")}.${format}`;
}
