/**
 * PDF financial statement (A4 portrait) with jsPDF + jspdf-autotable. Loaded only through a
 * dynamic import, so neither library enters the Reports page bundle.
 *
 * jsPDF's built-in Helvetica covers Latin-1 only, so text is passed through `pdfText`, which
 * keeps accents, swaps typographic punctuation for ASCII and replaces anything else (e.g. other
 * scripts, emoji) with "?" rather than printing garbage. Amounts use currency codes ("INR")
 * instead of symbols for the same reason; INR keeps Indian digit grouping.
 */

import type { jsPDF as JsPdfDoc } from "jspdf";
import { TRANSFERS_NOTE } from "@/lib/reportExport/build";
import {
  formatAmount,
  formatDisplayDate,
  formatGeneratedAt,
  formatMoneyText,
  formatSignedMoneyText,
  typeLabel,
} from "@/lib/reportExport/format";
import type { AccountStatement, CategorySummary, CurrencySummary, ExportReport } from "@/lib/reportExport/model";
import { TRANSACTION_CALENDAR_TIME_ZONE } from "@/lib/month";

type Rgb = [number, number, number];
const BRAND: Rgb = [5, 150, 105];
const BRAND_DARK: Rgb = [4, 120, 87];
const INCOME: Rgb = [4, 120, 87];
const EXPENSE: Rgb = [185, 28, 28];
const TEXT: Rgb = [15, 23, 42];
const MUTED: Rgb = [100, 116, 139];
const HEAD_FILL: Rgb = [236, 253, 245];
const ZEBRA: Rgb = [248, 250, 252];
const LINE: Rgb = [226, 232, 240];

const MARGIN_X = 14;
const TOP = 22; // leaves room for the running header on continuation pages
const BOTTOM = 18; // leaves room for the footer
const HISTORY_STYLES = {
  font: "helvetica",
  fontSize: 7.8,
  textColor: TEXT,
  cellPadding: { top: 1.6, bottom: 1.6, left: 1.6, right: 1.6 },
  overflow: "linebreak",
  valign: "top",
  lineColor: LINE,
} as const;

/** Map text to what the standard PDF fonts can draw (see the file comment). */
export function pdfText(value: string) {
  return value
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/₹/g, "Rs.")
    .replace(/[   ]/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^ -~¡-ÿ]/gu, "?");
}

type AutoTable = (doc: JsPdfDoc, options: import("jspdf-autotable").UserOptions) => void;

interface Ctx {
  doc: JsPdfDoc;
  autoTable: AutoTable;
  report: ExportReport;
  y: number;
}

const pageHeight = (doc: JsPdfDoc) => doc.internal.pageSize.getHeight();
const pageWidth = (doc: JsPdfDoc) => doc.internal.pageSize.getWidth();
const lastY = (doc: JsPdfDoc) => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? TOP;

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y + needed > pageHeight(ctx.doc) - BOTTOM) {
    ctx.doc.addPage();
    ctx.y = TOP;
  }
}

/** `keep` reserves room for the first rows of what follows, so a heading never ends a page. */
function heading(ctx: Ctx, text: string, sub?: string, keep = 22) {
  ensureSpace(ctx, (sub ? 15 : 11) + keep);
  const { doc } = ctx;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...BRAND_DARK);
  doc.text(pdfText(text), MARGIN_X, ctx.y + 5);
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, ctx.y + 7, MARGIN_X + 18, ctx.y + 7);
  ctx.y += 11;
  if (sub) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    const lines = doc.splitTextToSize(pdfText(sub), pageWidth(doc) - MARGIN_X * 2);
    doc.text(lines, MARGIN_X, ctx.y);
    ctx.y += lines.length * 3.8 + 1;
  }
}

function paragraph(ctx: Ctx, text: string) {
  const { doc } = ctx;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const lines: string[] = doc.splitTextToSize(pdfText(text), pageWidth(doc) - MARGIN_X * 2);
  for (const line of lines) {
    ensureSpace(ctx, 5);
    doc.text(line, MARGIN_X, ctx.y + 3);
    ctx.y += 4.3;
  }
  ctx.y += 2;
}

function table(ctx: Ctx, options: import("jspdf-autotable").UserOptions) {
  ensureSpace(ctx, 18);
  const { didParseCell, columnStyles } = options;
  ctx.autoTable(ctx.doc, {
    startY: ctx.y,
    margin: { left: MARGIN_X, right: MARGIN_X, top: TOP, bottom: BOTTOM },
    theme: "plain",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      textColor: TEXT,
      cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 },
      overflow: "linebreak",
      valign: "top",
      lineColor: LINE,
    },
    headStyles: { fillColor: HEAD_FILL, textColor: BRAND_DARK, fontStyle: "bold", lineWidth: { bottom: 0.3 }, lineColor: BRAND },
    alternateRowStyles: { fillColor: ZEBRA },
    ...options,
    didParseCell: (data) => {
      // Column styles don't reach the header row; align numeric headers with their values.
      const halign = columnStyles?.[data.column.index]?.halign;
      if (data.section === "head" && halign) data.cell.styles.halign = halign;
      didParseCell?.(data);
    },
  });
  ctx.y = lastY(ctx.doc) + 7;
}

function cover(ctx: Ctx) {
  const { doc, report } = ctx;
  const width = pageWidth(doc);
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, width, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("AccountTracker", MARGIN_X, 11);
  doc.setFontSize(18);
  doc.text(report.title, MARGIN_X, 21);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(pdfText(report.period.label), width - MARGIN_X, 21, { align: "right" });

  const { start, end } = report.period;
  const accountsText =
    report.accountMode === "single"
      ? report.statements[0]?.account.name ?? ""
      : `${report.statements.length} account${report.statements.length === 1 ? "" : "s"} (${
          report.accountMode === "combined" ? "combined" : "shown separately"
        })`;
  const meta: [string, string][] = [
    ["Reporting period", start && end ? `${formatDisplayDate(start)} - ${formatDisplayDate(end)}` : "All time (every transaction on record)"],
    ["Generated", `${formatGeneratedAt(report.generatedAt, TRANSACTION_CALENDAR_TIME_ZONE)} (India time)`],
    ["Accounts", accountsText],
    [
      "Data source",
      report.source.kind === "online"
        ? "Online - live account data"
        : `Offline copy on this device, last refreshed ${formatGeneratedAt(report.source.asOf, TRANSACTION_CALENDAR_TIME_ZONE)}`,
    ],
  ];
  let y = 40;
  doc.setFontSize(9);
  for (const [label, value] of meta) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...MUTED);
    doc.text(label, MARGIN_X, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT);
    const lines = doc.splitTextToSize(pdfText(value), width - MARGIN_X * 2 - 36);
    doc.text(lines, MARGIN_X + 36, y);
    y += lines.length * 4.4 + 1;
  }
  ctx.y = y + 4;
}

const tone = (value: number): Rgb => (value > 0 ? INCOME : value < 0 ? EXPENSE : TEXT);

function overview(ctx: Ctx) {
  const { summaries } = ctx.report;
  heading(
    ctx,
    "Financial overview",
    summaries.length > 1 ? "Accounts use different currencies; each currency is totalled separately and never converted." : undefined
  );
  const metrics: { label: string; pick: (s: CurrencySummary) => number; signed?: boolean; color?: (v: number) => Rgb }[] = [
    { label: "Opening balance", pick: (s) => s.opening },
    { label: "Total income", pick: (s) => s.income, color: () => INCOME },
    { label: "Total expenses", pick: (s) => s.expense, color: () => EXPENSE },
    { label: "Net cash flow", pick: (s) => s.net, signed: true, color: tone },
    { label: "Closing balance", pick: (s) => s.closing, color: tone },
  ];
  const body = metrics.map((metric) => [
    metric.label,
    ...summaries.map((s) =>
      metric.signed ? formatSignedMoneyText(metric.pick(s), s.currency) : formatMoneyText(metric.pick(s), s.currency)
    ),
  ]);
  body.push(["Transactions", ...summaries.map((s) => String(s.count))]);
  table(ctx, {
    head: [["", ...summaries.map((s) => s.currency)]],
    body,
    columnStyles: Object.fromEntries(summaries.map((_, i) => [i + 1, { halign: "right", fontStyle: "bold" }])),
    didParseCell: (data) => {
      if (data.section !== "body" || data.column.index === 0) return;
      const metric = metrics[data.row.index];
      const summary = summaries[data.column.index - 1];
      if (metric?.color && summary) data.cell.styles.textColor = metric.color(metric.pick(summary));
    },
  });
}

function categories(ctx: Ctx, title: string, type: "income" | "expense") {
  const { report } = ctx;
  heading(ctx, title);
  if (!report.categoriesAvailable) {
    paragraph(ctx, "Category details are unavailable for this data, so this summary is omitted.");
    return;
  }
  const multi = report.summaries.length > 1;
  const body: string[][] = [];
  for (const s of report.summaries) {
    const items: CategorySummary[] = type === "income" ? s.incomeCategories : s.expenseCategories;
    for (const item of items) {
      body.push([
        item.name,
        ...(multi ? [s.currency] : []),
        String(item.count),
        `${item.percent.toFixed(1)}%`,
        formatMoneyText(item.total, s.currency),
      ]);
    }
  }
  if (body.length === 0) {
    paragraph(ctx, `No ${type} in this period.`);
    return;
  }
  table(ctx, {
    head: [["Category", ...(multi ? ["Currency"] : []), "Transactions", "Share", "Amount"]],
    body,
    columnStyles: {
      [multi ? 2 : 1]: { halign: "right", cellWidth: 26 },
      [multi ? 3 : 2]: { halign: "right", cellWidth: 20 },
      [multi ? 4 : 3]: { halign: "right", cellWidth: 42, textColor: type === "income" ? INCOME : EXPENSE },
    },
  });
}

function accountSummary(ctx: Ctx) {
  heading(ctx, "Account-wise summary");
  table(ctx, {
    head: [["Account", "Opening", "Income", "Expenses", "Closing", "Txns"]],
    body: ctx.report.statements.map((st) => [
      `${st.account.name}${st.account.trashed ? " (in Trash)" : ""}\n${st.account.currency}${st.account.accountType ? ` - ${st.account.accountType}` : ""}`,
      formatMoneyText(st.opening, st.account.currency),
      formatMoneyText(st.income, st.account.currency),
      formatMoneyText(st.expense, st.account.currency),
      formatMoneyText(st.closing, st.account.currency),
      String(st.count),
    ]),
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right", textColor: INCOME },
      3: { halign: "right", textColor: EXPENSE },
      4: { halign: "right", fontStyle: "bold" },
      5: { halign: "right", cellWidth: 12 },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 0) data.cell.text = data.cell.text.map(pdfText);
    },
  });
}

const categoryText = (report: ExportReport, name: string | null) =>
  pdfText(name ?? (report.categoriesAvailable ? "Uncategorized" : "Unavailable"));

function combinedHistory(ctx: Ctx) {
  const { report } = ctx;
  heading(ctx, "Transaction history", `${report.rows.length} transaction${report.rows.length === 1 ? "" : "s"}, oldest first.`, 40);
  if (report.rows.length === 0) {
    paragraph(ctx, "No transactions in this period.");
    return;
  }
  table(ctx, {
    head: [["Date", "Time", "Account", "Category", "Description", "Type", "Amount"]],
    body: report.rows.map((row) => [
      formatDisplayDate(row.tx.date),
      row.tx.time ?? "",
      pdfText(row.accountName),
      categoryText(report, row.categoryName),
      pdfText(row.tx.description ?? ""),
      typeLabel(row.tx.type),
      `${row.tx.type === "income" ? "+" : "-"}${formatMoneyText(row.tx.amount, row.currency)}`,
    ]),
    styles: HISTORY_STYLES,
    columnStyles: {
      0: { cellWidth: 21 },
      1: { cellWidth: 12 },
      2: { cellWidth: 26 },
      3: { cellWidth: 24 },
      5: { cellWidth: 16 },
      6: { halign: "right", cellWidth: 29 },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 6) {
        data.cell.styles.textColor = report.rows[data.row.index].tx.type === "income" ? INCOME : EXPENSE;
      }
    },
  });
}

function statementSection(ctx: Ctx, st: AccountStatement) {
  const { report } = ctx;
  const cur = st.account.currency;
  heading(
    ctx,
    `Account: ${st.account.name}${st.account.trashed ? " (in Trash)" : ""}`,
    `${cur}${st.account.accountType ? ` - ${st.account.accountType}` : ""} · Opening ${formatMoneyText(st.opening, cur)} · Income ${formatMoneyText(
      st.income,
      cur
    )} · Expenses ${formatMoneyText(st.expense, cur)} · Closing ${formatMoneyText(st.closing, cur)}`,
    40
  );
  const body: string[][] = [["", "", "", "Opening balance", "", "", formatAmount(st.opening, cur)]];
  for (const row of st.rows) {
    body.push([
      formatDisplayDate(row.tx.date),
      row.tx.time ?? "",
      categoryText(report, row.categoryName),
      pdfText(row.tx.description ?? ""),
      row.tx.type === "income" ? formatAmount(row.tx.amount, cur) : "",
      row.tx.type === "expense" ? formatAmount(row.tx.amount, cur) : "",
      formatAmount(row.runningBalance, cur),
    ]);
  }
  body.push(["", "", "", "Closing balance", formatAmount(st.income, cur), formatAmount(st.expense, cur), formatAmount(st.closing, cur)]);
  const last = body.length - 1;
  table(ctx, {
    head: [["Date", "Time", "Category", "Description", `Income (${cur})`, `Expense (${cur})`, `Balance (${cur})`]],
    body,
    styles: HISTORY_STYLES,
    columnStyles: {
      0: { cellWidth: 21 },
      1: { cellWidth: 12 },
      2: { cellWidth: 25 },
      4: { halign: "right", cellWidth: 24, textColor: INCOME },
      5: { halign: "right", cellWidth: 24, textColor: EXPENSE },
      6: { halign: "right", cellWidth: 26 },
    },
    didParseCell: (data) => {
      if (data.section === "body" && (data.row.index === 0 || data.row.index === last)) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = HEAD_FILL;
      }
    },
  });
  if (st.rows.length === 0) paragraph(ctx, "No transactions for this account in this period.");
}

function transfers(ctx: Ctx) {
  heading(ctx, "Transfers", undefined, 10);
  paragraph(ctx, TRANSFERS_NOTE);
}

function closingNotes(ctx: Ctx) {
  const rest = ctx.report.notes.slice(1);
  if (!rest.length) return;
  heading(ctx, "Notes", undefined, 10);
  for (const note of rest) paragraph(ctx, `- ${note}`);
}

function decoratePages(ctx: Ctx) {
  const { doc, report } = ctx;
  const total = doc.getNumberOfPages();
  const width = pageWidth(doc);
  const height = pageHeight(doc);
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    if (page > 1) {
      doc.text(pdfText(`AccountTracker · ${report.title} · ${report.period.label}`), MARGIN_X, 12);
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.2);
      doc.line(MARGIN_X, 14.5, width - MARGIN_X, 14.5);
    }
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, height - 12, width - MARGIN_X, height - 12);
    doc.text(
      pdfText(`Generated ${formatGeneratedAt(report.generatedAt, TRANSACTION_CALENDAR_TIME_ZONE)} · ${report.source.kind === "online" ? "Online" : "Offline copy"}`),
      MARGIN_X,
      height - 7
    );
    doc.text(`Page ${page} of ${total}`, width - MARGIN_X, height - 7, { align: "right" });
  }
}

export async function buildPdf(report: ExportReport) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = (autoTableModule.autoTable ?? autoTableModule.default) as unknown as AutoTable;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  doc.setProperties({ title: `${report.title} - ${pdfText(report.period.label)}`, creator: "AccountTracker" });
  const ctx: Ctx = { doc, autoTable, report, y: TOP };

  cover(ctx);
  overview(ctx);
  categories(ctx, "Category-wise income summary", "income");
  categories(ctx, "Category-wise expense summary", "expense");
  accountSummary(ctx);
  transfers(ctx);

  if (report.accountMode === "combined") {
    combinedHistory(ctx);
  } else {
    for (const statement of report.statements) {
      if (report.accountMode === "separate") {
        doc.addPage();
        ctx.y = TOP;
      }
      statementSection(ctx, statement);
    }
  }
  closingNotes(ctx);
  decoratePages(ctx);
  return doc;
}

/** Load (and let the service worker cache) the PDF libraries without building anything. */
export async function preloadPdfLibraries() {
  await Promise.all([import("jspdf"), import("jspdf-autotable")]);
}

export async function pdfBlob(report: ExportReport) {
  const doc = await buildPdf(report);
  return doc.output("blob");
}
