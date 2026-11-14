/**
 * Export pipeline: data source → normalized dataset → shared calculations → file.
 * Exporters are dynamically imported so jsPDF / ExcelJS load only when an export runs.
 */

import { buildExportReport, selectAccounts } from "@/lib/reportExport/build";
import { buildExportFilename } from "@/lib/reportExport/format";
import type { DataSourceKind, ExportConfig, ExportReport, ReportDataset } from "@/lib/reportExport/model";
import { datasetFromOfflineRows, readOfflineRows, readOutboxCounts } from "@/lib/reportExport/sources/offline";
import type { ProgressFn } from "@/lib/reportExport/sources/online";

export class OfflineExportUnavailableError extends Error {
  constructor(readonly problems: string[]) {
    super(problems[0] ?? "A complete offline report can't be guaranteed.");
  }
}

export class ExportLibraryUnavailableError extends Error {}

/** Online → authenticated Supabase. Offline → validated IndexedDB snapshot. Never mixed. */
export function resolveDataSource(isOnline: boolean): DataSourceKind {
  return isOnline ? "online" : "offline";
}

export interface RunExportOptions {
  ownerId: string;
  activeOwnerId: string | null;
  defaultCurrency: string;
  config: ExportConfig;
  source: DataSourceKind;
  onProgress?: ProgressFn;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  report: ExportReport;
}

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function loadDataset(options: RunExportOptions): Promise<ReportDataset> {
  const { config, ownerId, onProgress } = options;
  if (options.source === "offline") {
    onProgress?.("Checking the offline copy…");
    const rows = await readOfflineRows(ownerId);
    const result = datasetFromOfflineRows(rows, {
      ownerId,
      activeOwnerId: options.activeOwnerId,
      defaultCurrency: options.defaultCurrency,
      period: config.period,
      requiredAccountId: config.accountMode === "single" ? config.accountId : null,
    });
    if (!result.ok) throw new OfflineExportUnavailableError(result.assessment.problems);
    return result.dataset;
  }

  const [{ createClient }, { loadOnlineDataset }, outbox] = await Promise.all([
    import("@/lib/supabase/client"),
    import("@/lib/reportExport/sources/online"),
    readOutboxCounts(ownerId).catch(() => ({ pending: 0, failed: 0 })),
  ]);
  return loadOnlineDataset({
    supabase: createClient(),
    ownerId,
    defaultCurrency: options.defaultCurrency,
    period: config.period,
    pendingChanges: outbox.pending,
    failedChanges: outbox.failed,
    onProgress,
  });
}

async function importExporter<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    // A lazily-loaded chunk that was never cached can't be fetched offline.
    throw new ExportLibraryUnavailableError(
      error instanceof Error && /chunk|fetch|import|network/i.test(error.message)
        ? "This file format hasn't been downloaded to this device yet. Export once while online to make it available offline."
        : "The export engine failed to load."
    );
  }
}

export async function runExport(options: RunExportOptions): Promise<ExportResult> {
  const { config, onProgress } = options;
  const dataset = await loadDataset(options);

  const selection = selectAccounts(dataset, config);
  if (!selection.ok) throw new Error(selection.error);

  onProgress?.(`Calculating ${dataset.transactions.length.toLocaleString("en-IN")} transactions…`);
  await yieldToBrowser();
  const report = buildExportReport(dataset, config);

  onProgress?.(`Building ${config.format === "xlsx" ? "Excel workbook" : config.format.toUpperCase()}…`);
  await yieldToBrowser();
  let blob: Blob;
  if (config.format === "pdf") {
    const { pdfBlob } = await importExporter(() => import("@/lib/reportExport/pdf"));
    blob = await pdfBlob(report);
  } else if (config.format === "xlsx") {
    const { xlsxBlob } = await importExporter(() => import("@/lib/reportExport/xlsx"));
    blob = await xlsxBlob(report);
  } else {
    const { csvBlob } = await import("@/lib/reportExport/csv");
    blob = csvBlob(report);
  }

  const account = config.accountMode === "single" ? selection.accounts[0] : null;
  return { blob, filename: buildExportFilename(config.period, config.accountMode, account, config.format), report };
}

/**
 * Warm the exporter chunks while online so the service worker caches them (cache-first for
 * /_next/static) and offline exports can load them later. Failures are ignored.
 */
export function prefetchExporters() {
  void import("@/lib/reportExport/pdf").then((m) => m.preloadPdfLibraries()).catch(() => undefined);
  void import("@/lib/reportExport/xlsx").then((m) => m.preloadExcelLibrary()).catch(() => undefined);
}
