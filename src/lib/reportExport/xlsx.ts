/**
 * XLSX export with ExcelJS. Loaded only through a dynamic import (see runExport), so ExcelJS
 * never enters the Reports page bundle.
 *
 * User-entered text is always written as a string cell (never a formula object), so Excel
 * cannot evaluate it; descriptions are kept exactly as typed.
 */

import type { Workbook, Worksheet } from "exceljs";
import { TRANSFERS_NOTE } from "@/lib/reportExport/build";
import { formatDisplayDate, formatGeneratedAt, typeLabel } from "@/lib/reportExport/format";
import type { AccountStatement, ExportReport, ReportRow } from "@/lib/reportExport/model";
import { TRANSACTION_CALENDAR_TIME_ZONE } from "@/lib/month";

const BRAND = "FF059669";
const INCOME = "FF047857";
const EXPENSE = "FFB91C1C";
const HEADER_FILL = "FFECFDF5";
const MAX_SHEET_NAME = 31;
const RESERVED_SHEETS = ["Summary", "All Transactions", "Transfers", "History"];

const NUM_FMT: Record<string, string> = {
  INR: '[$₹-4009]#,##0.00;-[$₹-4009]#,##0.00',
  USD: '[$$-409]#,##0.00;-[$$-409]#,##0.00',
  AED: '"AED "#,##0.00;-"AED "#,##0.00',
};
const numFmt = (currency: string) => NUM_FMT[currency] ?? `"${currency.replace(/"/g, "")} "#,##0.00;-"${currency.replace(/"/g, "")} "#,##0.00`;
const DATE_FMT = "dd-mmm-yyyy";

/** Excel sheet names: ≤31 chars, none of []:*?/\, no leading/trailing apostrophe, unique (case-insensitive). */
export function createSheetNamer(reserved: readonly string[] = RESERVED_SHEETS) {
  const used = new Set(reserved.map((name) => name.toLowerCase()));
  return (raw: string) => {
    let base = raw
      .replace(/[[\]:*?/\\]/g, " ")
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^'+|'+$/g, "")
      .trim();
    if (!base) base = "Account";
    base = base.slice(0, MAX_SHEET_NAME).trim();
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      name = `${base.slice(0, MAX_SHEET_NAME - suffix.length).trim()}${suffix}`;
    }
    used.add(name.toLowerCase());
    return name;
  };
}

function excelDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function styleHeader(sheet: Worksheet, rowNumber: number, columns: number) {
  const row = sheet.getRow(rowNumber);
  for (let c = 1; c <= columns; c += 1) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: "FF0F172A" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = { bottom: { style: "thin", color: { argb: BRAND } } };
    cell.alignment = { vertical: "middle" };
  }
}

function addTitle(sheet: Worksheet, title: string, report: ExportReport) {
  sheet.addRow([title]).font = { bold: true, size: 14, color: { argb: BRAND } };
  sheet.addRow(["Reporting period", periodText(report)]);
  sheet.addRow(["Generated", formatGeneratedAt(report.generatedAt, TRANSACTION_CALENDAR_TIME_ZONE)]);
  sheet.addRow(["Data source", sourceText(report)]);
  for (let r = 2; r <= 4; r += 1) sheet.getRow(r).getCell(1).font = { bold: true };
}

export function periodText(report: ExportReport) {
  const { start, end, label } = report.period;
  return start && end ? `${label} (${formatDisplayDate(start)} – ${formatDisplayDate(end)})` : label;
}

export function sourceText(report: ExportReport) {
  const { source } = report;
  return source.kind === "online"
    ? "Online (live account data)"
    : `Offline copy on this device (last refreshed ${formatGeneratedAt(source.asOf, TRANSACTION_CALENDAR_TIME_ZONE)})`;
}

function addSectionTitle(sheet: Worksheet, text: string) {
  sheet.addRow([]);
  sheet.addRow([text]).font = { bold: true, size: 12, color: { argb: BRAND } };
}

function addTableHeader(sheet: Worksheet, headers: string[]) {
  const row = sheet.addRow(headers);
  styleHeader(sheet, row.number, headers.length);
  return row.number;
}

function money(sheet: Worksheet, rowNumber: number, columns: number[], currency: string) {
  const row = sheet.getRow(rowNumber);
  for (const c of columns) row.getCell(c).numFmt = numFmt(currency);
}

function buildSummary(workbook: Workbook, report: ExportReport) {
  const sheet = workbook.addWorksheet("Summary", { properties: { defaultColWidth: 16 } });
  sheet.columns = [
    { width: 30 },
    { width: 22 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 14 },
    { width: 18 },
    { width: 14 },
  ];
  addTitle(sheet, "Financial Statement", report);

  addSectionTitle(sheet, "Financial overview");
  addTableHeader(sheet, [
    "Currency",
    "Accounts",
    "Opening balance",
    "Total income",
    "Total expenses",
    "Net cash flow",
    "Closing balance",
    "Transactions",
  ]);
  for (const s of report.summaries) {
    const row = sheet.addRow([s.currency, s.accountCount, s.opening, s.income, s.expense, s.net, s.closing, s.count]);
    money(sheet, row.number, [3, 4, 5, 6, 7], s.currency);
    row.getCell(4).font = { color: { argb: INCOME } };
    row.getCell(5).font = { color: { argb: EXPENSE } };
  }

  addSectionTitle(sheet, "Account summary");
  addTableHeader(sheet, [
    "Account",
    "Type",
    "Currency",
    "Opening balance",
    "Income",
    "Expenses",
    "Net cash flow",
    "Status",
    "Closing balance",
    "Transactions",
  ]);
  for (const st of report.statements) {
    const row = sheet.addRow([
      st.account.name,
      st.account.accountType ?? "",
      st.account.currency,
      st.opening,
      st.income,
      st.expense,
      st.net,
      st.account.trashed ? "In Trash" : "Active",
      st.closing,
      st.count,
    ]);
    money(sheet, row.number, [4, 5, 6, 7, 9], st.account.currency);
  }

  addSectionTitle(sheet, "Category summary");
  if (!report.categoriesAvailable) {
    sheet.addRow(["Category details are unavailable for this data, so the category summary is omitted."]);
  } else {
    addTableHeader(sheet, ["Category", "Type", "Currency", "Amount", "Share", "Transactions"]);
    for (const s of report.summaries) {
      for (const [type, items] of [
        ["Income", s.incomeCategories],
        ["Expense", s.expenseCategories],
      ] as const) {
        for (const item of items) {
          const row = sheet.addRow([item.name, type, s.currency, item.total, item.percent / 100, item.count]);
          money(sheet, row.number, [4], s.currency);
          row.getCell(5).numFmt = "0.0%";
        }
      }
    }
  }

  addSectionTitle(sheet, "Transfers");
  sheet.addRow([TRANSFERS_NOTE]);
  if (report.notes.length > 1) {
    addSectionTitle(sheet, "Notes");
    for (const note of report.notes.slice(1)) sheet.addRow([note]);
  }
}

function addTransactionRow(sheet: Worksheet, row: ReportRow, withAccount: boolean, categoriesAvailable: boolean) {
  const { tx } = row;
  const category = row.categoryName ?? (categoriesAvailable ? "Uncategorized" : "Unavailable");
  const values = withAccount
    ? [excelDate(tx.date), tx.time ?? "", row.accountName, category, tx.description ?? "", typeLabel(tx.type), tx.amount, row.currency]
    : [
        excelDate(tx.date),
        tx.time ?? "",
        category,
        tx.description ?? "",
        tx.type === "income" ? tx.amount : null,
        tx.type === "expense" ? tx.amount : null,
        row.runningBalance,
      ];
  const added = sheet.addRow(values);
  added.getCell(1).numFmt = DATE_FMT;
  if (withAccount) {
    added.getCell(7).numFmt = numFmt(row.currency);
    added.getCell(7).font = { color: { argb: tx.type === "income" ? INCOME : EXPENSE } };
  } else {
    money(sheet, added.number, [5, 6, 7], row.currency);
    added.getCell(5).font = { color: { argb: INCOME } };
    added.getCell(6).font = { color: { argb: EXPENSE } };
  }
}

function buildAllTransactions(workbook: Workbook, report: ExportReport) {
  const sheet = workbook.addWorksheet("All Transactions", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { width: 13 },
    { width: 8 },
    { width: 24 },
    { width: 20 },
    { width: 44 },
    { width: 10 },
    { width: 16 },
    { width: 10 },
  ];
  const headers = ["Date", "Time", "Account", "Category", "Description", "Type", "Amount", "Currency"];
  addTableHeader(sheet, headers);
  for (const row of report.rows) addTransactionRow(sheet, row, true, report.categoriesAvailable);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

function buildAccountSheet(workbook: Workbook, name: string, statement: AccountStatement, report: ExportReport) {
  const { account } = statement;
  const sheet = workbook.addWorksheet(name);
  sheet.columns = [{ width: 18 }, { width: 8 }, { width: 20 }, { width: 44 }, { width: 16 }, { width: 16 }, { width: 18 }];
  sheet.addRow([account.name]).font = { bold: true, size: 14, color: { argb: BRAND } };
  const details: [string, string | number][] = [
    ["Account type", account.accountType ?? ""],
    ["Currency", account.currency],
    ["Status", account.trashed ? "In Trash" : "Active"],
    ["Reporting period", periodText(report)],
    ["Opening balance", statement.opening],
    ["Income", statement.income],
    ["Expenses", statement.expense],
    ["Transfers", "Not tracked by this app"],
    ["Closing balance", statement.closing],
  ];
  for (const [label, value] of details) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    if (typeof value === "number") row.getCell(2).numFmt = numFmt(account.currency);
  }
  // Values in column B span the narrow Time column visually.
  sheet.getColumn(2).alignment = { horizontal: "left" };
  sheet.addRow([]);
  const headers = ["Date", "Time", "Category", "Description", "Income", "Expense", "Balance"];
  const headerRow = addTableHeader(sheet, headers);
  for (const row of statement.rows) addTransactionRow(sheet, row, false, report.categoriesAvailable);
  if (statement.rows.length === 0) sheet.addRow(["No transactions in this period."]);
  sheet.views = [{ state: "frozen", ySplit: headerRow }];
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: headers.length } };
}

type ExcelModule = typeof import("exceljs");

async function loadExcel(): Promise<ExcelModule> {
  const mod = (await import("exceljs")) as ExcelModule & { default?: ExcelModule };
  return mod.Workbook ? mod : (mod.default as ExcelModule);
}

/** Load (and let the service worker cache) ExcelJS without building anything. */
export async function preloadExcelLibrary() {
  await loadExcel();
}

/** Sheets: Summary, All Transactions (multi-account), then one per account (separate or single). */
export async function buildWorkbook(report: ExportReport) {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AccountTracker";
  workbook.created = new Date(report.generatedAt);
  workbook.title = `Financial Statement – ${report.period.label}`;

  buildSummary(workbook, report);
  if (report.accountMode !== "single") buildAllTransactions(workbook, report);
  if (report.accountMode !== "combined") {
    const nameFor = createSheetNamer();
    for (const statement of report.statements) {
      buildAccountSheet(workbook, nameFor(statement.account.name), statement, report);
    }
  }
  return workbook;
}

export async function xlsxBlob(report: ExportReport) {
  const workbook = await buildWorkbook(report);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
