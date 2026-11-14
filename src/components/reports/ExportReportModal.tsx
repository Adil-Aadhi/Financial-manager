"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CloudOff, FileSpreadsheet, FileText, Share2, Sheet, Wifi } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { normalizeIncludeInSummary } from "@/lib/accountSummary";
import { offlineDb } from "@/lib/offline/db";
import { useActiveOwnerId } from "@/lib/offline/activeOwner";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import { canShareFile, downloadBlob, shareBlob, shouldUseShareSheet } from "@/lib/reportExport/download";
import { formatDisplayDate, formatGeneratedAt } from "@/lib/reportExport/format";
import type { AccountMode, DataSourceKind, ExportFormat } from "@/lib/reportExport/model";
import {
  EXPORT_PERIOD_OPTIONS,
  exportToday,
  resolveExportPeriod,
  type ExportPeriod,
  type ExportPeriodKind,
} from "@/lib/reportExport/period";
import {
  ExportLibraryUnavailableError,
  OfflineExportUnavailableError,
  resolveDataSource,
  runExport,
  type ExportResult,
} from "@/lib/reportExport/runExport";
import { TRANSACTION_CALENDAR_TIME_ZONE } from "@/lib/month";

const ACCOUNT_MODES: { id: AccountMode; label: string }[] = [
  { id: "combined", label: "All combined" },
  { id: "single", label: "One account" },
  { id: "separate", label: "All, separately" },
];

const FORMATS: { id: ExportFormat; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: "pdf", label: "PDF", hint: "Full statement", icon: <FileText className="h-4 w-4" /> },
  { id: "xlsx", label: "Excel", hint: "Multi-sheet workbook", icon: <FileSpreadsheet className="h-4 w-4" /> },
  { id: "csv", label: "CSV", hint: "Transaction rows", icon: <Sheet className="h-4 w-4" /> },
];

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, i, 1)))
);

interface PickerAccount {
  id: string;
  name: string;
  currency: string | null;
  trashed: boolean;
  included: boolean;
}

type Status =
  | { kind: "idle" }
  | { kind: "running"; message: string }
  /** viaShare: iOS, where the file is saved through the share sheet on the user's next tap. */
  | { kind: "done"; result: ExportResult; viaShare: boolean; shareError?: string }
  | { kind: "error"; message: string; problems?: string[]; offlineFallback?: boolean };

function chipClass(active: boolean) {
  return cn(
    "flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
    active ? "border-transparent bg-brand text-accent-fg shadow-glow" : "border-line bg-glass-input text-fg-muted hover:text-fg"
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[13px] font-medium text-fg-muted">{children}</p>;
}

export function ExportReportModal({
  isOpen,
  onClose,
  ownerId,
  defaultCurrency,
}: {
  isOpen: boolean;
  onClose: () => void;
  ownerId: string;
  defaultCurrency: string;
}) {
  const isOnline = useOnlineStatus();
  const activeOwnerId = useActiveOwnerId();
  const today = useMemo(() => exportToday(), []);

  const [periodKind, setPeriodKind] = useState<ExportPeriodKind>("current-month");
  const [month, setMonth] = useState(today.month);
  const [monthYear, setMonthYear] = useState(today.year);
  const [year, setYear] = useState(today.year);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [accountMode, setAccountMode] = useState<AccountMode>("combined");
  const [accountId, setAccountId] = useState("");
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [sourceOverride, setSourceOverride] = useState<DataSourceKind | null>(null);
  const runId = useRef(0);

  const local = useLiveQuery(async () => {
    const [meta, accounts] = await Promise.all([
      offlineDb.syncMeta.get(ownerId),
      offlineDb.accounts.where("ownerId").equals(ownerId).toArray(),
    ]);
    return {
      meta: meta ?? null,
      accounts: accounts.map<PickerAccount>((account) => ({
        id: account.id,
        name: account.name,
        currency: account.currency,
        trashed: Boolean(account.deleted_at),
        included: normalizeIncludeInSummary(account.include_in_summary),
      })),
    };
  }, [ownerId]);

  // A device that has never completed a snapshot has no local account list: read it online.
  const [remoteAccounts, setRemoteAccounts] = useState<PickerAccount[] | null>(null);
  const needsRemote = isOpen && isOnline && local !== undefined && local.accounts.length === 0 && remoteAccounts === null;
  useEffect(() => {
    if (!needsRemote) return;
    let cancelled = false;
    import("@/lib/supabase/client")
      .then(async ({ createClient }) => {
        const { data, error } = await createClient()
          .from("accounts")
          .select("id, name, currency, deleted_at")
          .eq("user_id", ownerId)
          .order("name");
        if (cancelled || error) return;
        setRemoteAccounts(
          (data ?? []).map((row) => ({
            id: String(row.id),
            name: row.name,
            currency: row.currency,
            trashed: Boolean(row.deleted_at),
            included: true,
          }))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [needsRemote, ownerId]);

  const accounts = useMemo(() => {
    const list = local?.accounts.length ? local.accounts : remoteAccounts ?? [];
    return [...list].sort((a, b) => Number(a.trashed) - Number(b.trashed) || a.name.localeCompare(b.name));
  }, [local, remoteAccounts]);
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const effectiveAccountId = selectedAccount ? selectedAccount.id : accounts.find((a) => !a.trashed)?.id ?? "";

  const period: ExportPeriod = useMemo(() => {
    switch (periodKind) {
      case "month":
        return { kind: "month", year: monthYear, month };
      case "year":
        return { kind: "year", year };
      case "custom":
        return { kind: "custom", start: customStart, end: customEnd };
      default:
        return { kind: periodKind } as ExportPeriod;
    }
  }, [customEnd, customStart, month, monthYear, periodKind, year]);
  const resolved = useMemo(() => resolveExportPeriod(period), [period]);
  const customIncomplete = periodKind === "custom" && (!customStart || !customEnd);

  const autoSource = resolveDataSource(isOnline);
  const source: DataSourceKind = isOnline ? sourceOverride ?? autoSource : "offline";
  const offlineReady = Boolean(local?.meta?.totalsMatch);

  const years = useMemo(() => Array.from({ length: 16 }, (_, i) => today.year + 1 - i), [today.year]);
  const running = status.kind === "running";

  let blocker: string | null = null;
  if (!resolved.ok && !customIncomplete) blocker = resolved.error;
  else if (customIncomplete) blocker = "Choose a start and end date.";
  else if (accountMode === "single" && !effectiveAccountId) blocker = "Choose an account.";
  else if (source === "offline" && !offlineReady) {
    blocker = local?.meta
      ? "The offline copy on this device couldn't be verified as complete. Connect to the internet to export."
      : "This device doesn't have a complete offline copy of your data yet. Connect to the internet to export.";
  }

  const resetResult = useCallback(() => {
    runId.current += 1;
    setStatus({ kind: "idle" });
  }, []);

  const close = () => {
    runId.current += 1; // ignore a run still in flight; its blob is dropped with it
    setStatus({ kind: "idle" });
    setSourceOverride(null);
    onClose();
  };

  const startExport = async () => {
    if (running || blocker || !resolved.ok) return;
    const id = ++runId.current;
    setStatus({ kind: "running", message: "Preparing…" });
    try {
      const result = await runExport({
        ownerId,
        activeOwnerId,
        defaultCurrency,
        source,
        config: {
          period: resolved.period,
          accountMode,
          accountId: accountMode === "single" ? effectiveAccountId : null,
          includeExcluded,
          format,
        },
        onProgress: (message) => {
          if (runId.current === id) setStatus({ kind: "running", message });
        },
      });
      if (runId.current !== id) return;
      // iOS can't save a generated file as a download (it opens it full-screen, with no way
      // back inside the installed app), and the share sheet needs a fresh tap after the async
      // work, so iOS gets a "Save to Files / Share" button instead of an automatic download.
      const viaShare = shouldUseShareSheet(result.blob, result.filename);
      if (!viaShare) downloadBlob(result.blob, result.filename);
      setStatus({ kind: "done", result, viaShare });
    } catch (error) {
      if (runId.current !== id) return;
      if (error instanceof OfflineExportUnavailableError) {
        setStatus({ kind: "error", message: "A complete offline report can't be guaranteed.", problems: error.problems });
        return;
      }
      const message = error instanceof Error ? error.message : "The export failed.";
      const network = source === "online" && error instanceof TypeError;
      setStatus({
        kind: "error",
        message:
          error instanceof ExportLibraryUnavailableError
            ? message
            : network
              ? "Couldn't reach the server. Check your connection and try again."
              : message,
        offlineFallback: network && offlineReady,
      });
    }
  };

  const doneResult = status.kind === "done" ? status.result : null;
  const viaShare = status.kind === "done" && status.viaShare;
  const shareError = status.kind === "done" ? status.shareError : undefined;
  const shareable = doneResult ? canShareFile(doneResult.blob, doneResult.filename) : false;

  const shareResult = async () => {
    if (status.kind !== "done") return;
    const current = status;
    try {
      await shareBlob(current.result.blob, current.result.filename);
      setStatus({ ...current, shareError: undefined });
    } catch {
      setStatus({ ...current, shareError: "Couldn't open the share sheet. Tap the button again." });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Export report" description="Download a statement for any period and account." size="lg">
      <div className="space-y-5">
        <section aria-label="Reporting period">
          <SectionLabel>Reporting period</SectionLabel>
          <div role="radiogroup" aria-label="Reporting period" className="flex flex-wrap gap-2">
            {EXPORT_PERIOD_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={periodKind === option.id}
                disabled={running}
                onClick={() => {
                  setPeriodKind(option.id);
                  resetResult();
                }}
                className={chipClass(periodKind === option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {periodKind === "month" && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Select label="Month" value={month} onChange={(e) => { setMonth(Number(e.target.value)); resetResult(); }} className="text-base sm:text-sm">
                {MONTHS.map((name, i) => (
                  <option key={name} value={i + 1}>{name}</option>
                ))}
              </Select>
              <Select label="Year" value={monthYear} onChange={(e) => { setMonthYear(Number(e.target.value)); resetResult(); }} className="text-base sm:text-sm">
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </Select>
            </div>
          )}
          {periodKind === "year" && (
            <div className="mt-3 max-w-[50%] pr-1.5">
              <Select label="Year" value={year} onChange={(e) => { setYear(Number(e.target.value)); resetResult(); }} className="text-base sm:text-sm">
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </Select>
            </div>
          )}
          {periodKind === "custom" && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Input
                label="From"
                type="date"
                value={customStart}
                max={customEnd || undefined}
                onChange={(e) => { setCustomStart(e.target.value); resetResult(); }}
                className="h-12 text-base sm:text-sm"
              />
              <Input
                label="To"
                type="date"
                value={customEnd}
                min={customStart || undefined}
                onChange={(e) => { setCustomEnd(e.target.value); resetResult(); }}
                className="h-12 text-base sm:text-sm"
              />
              {!resolved.ok && !customIncomplete && (
                <p className="col-span-2 animate-fade text-xs font-medium text-danger">{resolved.error}</p>
              )}
            </div>
          )}
        </section>

        <section aria-label="Accounts">
          <SectionLabel>Accounts</SectionLabel>
          <div role="radiogroup" aria-label="Account selection" className="glass-track grid grid-cols-3 gap-0.5 rounded-full p-0.5">
            {ACCOUNT_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={accountMode === mode.id}
                disabled={running}
                onClick={() => {
                  setAccountMode(mode.id);
                  resetResult();
                }}
                className={cn(
                  "h-9 cursor-pointer rounded-full px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                  accountMode === mode.id ? "glass text-fg" : "text-fg-subtle hover:text-fg"
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            {accountMode === "single" ? (
              <Select
                label="Account"
                value={effectiveAccountId}
                onChange={(e) => { setAccountId(e.target.value); resetResult(); }}
                disabled={running || accounts.length === 0}
                helperText={accounts.length === 0 ? "Loading accounts…" : undefined}
                className="text-base sm:text-sm"
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                    {account.currency ? ` (${account.currency})` : ""}
                    {account.trashed ? " · in Trash" : ""}
                  </option>
                ))}
              </Select>
            ) : (
              <Checkbox
                checked={includeExcluded}
                disabled={running}
                onChange={(e) => { setIncludeExcluded(e.target.checked); resetResult(); }}
                label="Include accounts excluded from summary"
                description={
                  accountMode === "combined"
                    ? "Combined totals and one transaction list with an Account column."
                    : "A section (PDF) or worksheet (Excel) for each account."
                }
              />
            )}
          </div>
        </section>

        <section aria-label="Format">
          <SectionLabel>Format</SectionLabel>
          <div role="radiogroup" aria-label="Export format" className="grid grid-cols-3 gap-2">
            {FORMATS.map((option) => {
              const active = format === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={running}
                  onClick={() => {
                    setFormat(option.id);
                    resetResult();
                  }}
                  className={cn(
                    "flex cursor-pointer flex-col items-start gap-1 rounded-2xl border p-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                    active ? "border-accent/60 bg-accent/10" : "border-line bg-glass-input hover:border-line-strong"
                  )}
                >
                  <span className={cn("flex items-center gap-1.5 text-sm font-semibold", active ? "text-accent" : "text-fg")}>
                    {option.icon}
                    {option.label}
                  </span>
                  <span className="text-[11px] leading-tight text-fg-subtle">{option.hint}</span>
                </button>
              );
            })}
          </div>
          {format === "csv" && (
            <p className="mt-2 text-xs text-fg-subtle">
              CSV exports transaction rows only (date, time, account, category, description, type, amount). Choose PDF or
              Excel for a full statement with balances and summaries.
            </p>
          )}
        </section>

        <section aria-label="Export summary" className="rounded-2xl border border-line bg-glass-hover p-3.5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-fg-subtle">Period</dt>
            <dd className="min-w-0 font-medium text-fg">
              {resolved.ok
                ? resolved.period.start && resolved.period.end
                  ? `${resolved.period.label} · ${formatDisplayDate(resolved.period.start)} – ${formatDisplayDate(resolved.period.end)}`
                  : "All time"
                : "—"}
            </dd>
            <dt className="text-fg-subtle">Accounts</dt>
            <dd className="min-w-0 truncate font-medium text-fg">
              {accountMode === "single"
                ? accounts.find((a) => a.id === effectiveAccountId)?.name ?? "—"
                : `${accountMode === "combined" ? "All accounts, combined" : "All accounts, separately"}${includeExcluded ? " (incl. excluded)" : ""}`}
            </dd>
            <dt className="text-fg-subtle">Format</dt>
            <dd className="font-medium text-fg">{FORMATS.find((f) => f.id === format)?.label}</dd>
            <dt className="text-fg-subtle">Data source</dt>
            <dd className="flex items-center gap-1.5 font-medium text-fg">
              {source === "online" ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-positive" aria-hidden="true" /> Online
                </>
              ) : (
                <>
                  <CloudOff className="h-3.5 w-3.5 text-warning" aria-hidden="true" /> Offline copy
                  {local?.meta && (
                    <span className="font-normal text-fg-subtle">
                      · refreshed {formatGeneratedAt(local.meta.completedAt, TRANSACTION_CALENDAR_TIME_ZONE)}
                    </span>
                  )}
                </>
              )}
            </dd>
          </dl>
        </section>

        {blocker && status.kind !== "error" && (
          <Alert variant={source === "offline" && !offlineReady ? "warning" : "info"}>{blocker}</Alert>
        )}

        {status.kind === "error" && (
          <Alert variant="error" title="Export failed" onClose={resetResult}>
            <p>{status.message}</p>
            {status.problems && status.problems.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {status.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
            {status.problems && <p className="mt-1">Connect to the internet to export from your live data.</p>}
            {status.offlineFallback && (
              <button
                type="button"
                onClick={() => {
                  setSourceOverride("offline");
                  resetResult();
                }}
                className="mt-1.5 cursor-pointer font-semibold text-accent hover:text-accent-strong"
              >
                Use this device&apos;s offline copy instead
              </button>
            )}
          </Alert>
        )}

        {doneResult && (
          <Alert variant="success" title="Report ready">
            <p className="break-all">
              {viaShare
                ? `${doneResult.filename} is ready. Tap Save to Files / Share to keep it.`
                : `${doneResult.filename} has been downloaded.`}
            </p>
            {doneResult.report.notes.slice(1).map((note) => (
              <p key={note} className="mt-0.5">{note}</p>
            ))}
            {shareError && <p className="mt-1 font-medium text-danger">{shareError}</p>}
            {viaShare ? (
              <Button
                size="lg"
                className="mt-3 w-full"
                leftIcon={<Share2 className="h-4 w-4" />}
                onClick={() => void shareResult()}
              >
                Save to Files / Share
              </Button>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => downloadBlob(doneResult.blob, doneResult.filename)}>
                  Download again
                </Button>
                {shareable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Share2 className="h-3.5 w-3.5" />}
                    onClick={() => void shareResult()}
                  >
                    Share
                  </Button>
                )}
              </div>
            )}
          </Alert>
        )}

        <div className="space-y-2">
          <Button size="lg" className="w-full" onClick={startExport} isLoading={running} disabled={Boolean(blocker)}>
            {running ? "Exporting…" : `Export ${FORMATS.find((f) => f.id === format)?.label}`}
          </Button>
          <p aria-live="polite" className="min-h-4 text-center text-xs text-fg-subtle">
            {status.kind === "running" ? status.message : ""}
          </p>
        </div>
      </div>
    </Modal>
  );
}
