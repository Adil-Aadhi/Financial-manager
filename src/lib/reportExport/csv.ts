/**
 * CSV export: one row per transaction (not a multi-section statement). RFC 4180 quoting,
 * CRLF line endings, UTF-8 with a BOM so Excel detects the encoding, and formula
 * neutralisation for user-entered text.
 */

import { neutralizeFormula, typeLabel } from "@/lib/reportExport/format";
import type { ExportReport } from "@/lib/reportExport/model";

export const CSV_HEADERS = ["Date", "Time", "Account", "Currency", "Category", "Description", "Type", "Amount"];
const BOM = "﻿";

export function escapeCsvCell(value: string) {
  const safe = neutralizeFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildCsv(report: ExportReport) {
  const lines = [CSV_HEADERS.join(",")];
  for (const row of report.rows) {
    const { tx } = row;
    lines.push(
      [
        // ISO dates sort and parse reliably in every spreadsheet; the display date is ambiguous.
        tx.date,
        tx.time ?? "",
        escapeCsvCell(row.accountName),
        row.currency,
        escapeCsvCell(row.categoryName ?? (report.categoriesAvailable ? "Uncategorized" : "Unavailable")),
        escapeCsvCell(tx.description ?? ""),
        typeLabel(tx.type),
        tx.amount.toFixed(2),
      ].join(",")
    );
  }
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

export function csvBlob(report: ExportReport) {
  return new Blob([buildCsv(report)], { type: "text/csv;charset=utf-8" });
}
