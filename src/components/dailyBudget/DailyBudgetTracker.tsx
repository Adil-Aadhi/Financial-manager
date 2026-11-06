"use client";

import React, { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  Pencil,
  Plus,
  ReceiptText,
  Settings2,
  Trash2,
} from "lucide-react";
import { deleteDailyLimitAction } from "@/app/actions/dailyBudget";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import {
  addMonths,
  calculateDailyBudgetMonth,
  calculateDailyBudgetToday,
  dailyBudgetMonths,
  formatDayLabel,
  formatMonthLabel,
  groupExpensesByDate,
  limitOn,
  monthLastDay,
  monthOfDate,
  normalizeLimits,
  type DailyBudgetDay,
  type DailyExpenseRecord,
  type DailyLimitRecord,
} from "@/lib/dailyBudget";
import { formatMoney } from "@/lib/format";
import { deleteDailyLimitLocally } from "@/lib/offline/mutations";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import type { DailyBudgetServerData } from "@/lib/supabase/dailyBudget";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { ConfirmModal, ExpenseModal, LimitModal, useDailyBudgetMutation } from "./DailyBudgetModals";
import { signedMoney } from "./format";
import { TodayProgress } from "./TodayProgress";
import { useDailyBudgetData, useDailyBudgetToday } from "./useDailyBudget";

type ModalState =
  | { kind: "add"; date: string }
  | { kind: "edit"; expense: DailyExpenseRecord }
  | { kind: "limit"; setup: boolean }
  | { kind: "deleteLimit"; limit: DailyLimitRecord }
  | null;

const tone = (value: number) => (value < 0 ? "text-danger" : value > 0 ? "text-positive" : "text-fg");

export function DailyBudgetTracker({
  ownerId,
  currency,
  server,
  serverToday,
}: {
  ownerId: string;
  currency: SupportedCurrency;
  server: DailyBudgetServerData;
  serverToday: string;
}) {
  const data = useDailyBudgetData(ownerId, server);
  const today = useDailyBudgetToday(serverToday);
  const isOnline = useOnlineStatus();
  const currentMonth = monthOfDate(today);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const viewMonth = selectedMonth ?? currentMonth;
  const [modal, setModal] = useState<ModalState>(null);
  const close = () => setModal(null);

  const months = useMemo(() => dailyBudgetMonths(data.limits, data.expenses, today), [data.limits, data.expenses, today]);
  const month = useMemo(
    () => calculateDailyBudgetMonth(data.limits, data.expenses, viewMonth, today),
    [data.limits, data.expenses, viewMonth, today]
  );
  const overview = useMemo(
    () => calculateDailyBudgetToday(data.limits, data.expenses, today),
    [data.limits, data.expenses, today]
  );
  const expensesByDate = useMemo(() => groupExpensesByDate(data.expenses, viewMonth), [data.expenses, viewMonth]);

  if (!data.available) {
    return (
      <Card>
        <EmptyState
          icon={<CalendarDays className="h-5 w-5" />}
          title="Daily budget needs a database update"
          description="Run the daily-budget migration to turn this feature on."
        />
      </Card>
    );
  }

  const configured = data.limits.length > 0;
  const earliestMonth = months[months.length - 1];
  const canGoBack = viewMonth > earliestMonth;
  const canGoForward = viewMonth < currentMonth;
  // New entries default to today, or to the last day of a past month being viewed.
  const defaultEntryDate = viewMonth === currentMonth ? today : monthLastDay(viewMonth);

  return (
    <div className="space-y-4 sm:space-y-5">
      {!isOnline && (
        <Alert variant="info">You are offline. Changes are saved on this device and sync when you reconnect.</Alert>
      )}

      {configured ? (
        <TodayOverview
          currency={currency}
          overview={overview}
          onAdd={() => setModal({ kind: "add", date: today })}
        />
      ) : (
        <SetupCard onSetup={() => setModal({ kind: "limit", setup: true })} hasExpenses={data.expenses.length > 0} />
      )}

      {(configured || data.expenses.length > 0) && (
        <>
          <section aria-label="Month" className="glass glass-edge rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setSelectedMonth(addMonths(viewMonth, -1))}
                disabled={!canGoBack}
                aria-label="Previous month"
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-glass-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 text-center">
                <h2 className="truncate text-[15px] font-semibold tracking-tight text-fg" aria-live="polite">
                  {formatMonthLabel(viewMonth)}
                </h2>
                <p className="text-[11px] text-fg-subtle">
                  {viewMonth === currentMonth
                    ? "This month · started at zero"
                    : "Closed month · late entries update this month only"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMonth(canGoForward ? addMonths(viewMonth, 1) : null)}
                disabled={!canGoForward}
                aria-label="Next month"
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-glass-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <MonthSummary currency={currency} totals={month.totals} closed={month.closed} hasDays={month.days.length > 0} />
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => setModal({ kind: "add", date: defaultEntryDate })}
              >
                {viewMonth === currentMonth ? "Add expense" : `Add expense in ${formatMonthLabel(viewMonth)}`}
              </Button>
              {viewMonth !== currentMonth && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedMonth(null)}>
                  Back to this month
                </Button>
              )}
            </div>
          </section>

          <Card title="Daily breakdown" description="Newest first · tap a day to see or add its expenses" bodyClassName="pt-2">
            {month.days.length === 0 ? (
              <EmptyState
                icon={<ReceiptText className="h-5 w-5" />}
                title={viewMonth > currentMonth ? "This month hasn't started" : "Nothing tracked this month"}
                description="Days appear once your daily budget has started."
              />
            ) : (
              <ul className="divide-y divide-line">
                {[...month.days].reverse().map((day) => (
                  <DayRow
                    key={day.date}
                    day={day}
                    today={today}
                    currency={currency}
                    expenses={expensesByDate.get(day.date) ?? []}
                    onAdd={() => setModal({ kind: "add", date: day.date })}
                    onEdit={(expense) => setModal({ kind: "edit", expense })}
                  />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {configured && (
        <LimitSettings
          currency={currency}
          today={today}
          limits={data.limits}
          onChange={() => setModal({ kind: "limit", setup: false })}
          onDelete={(limit) => setModal({ kind: "deleteLimit", limit })}
        />
      )}

      {modal?.kind === "add" && (
        <ExpenseModal onClose={close} currency={currency} today={today} defaultDate={modal.date} />
      )}
      {modal?.kind === "edit" && (
        <ExpenseModal
          onClose={close}
          currency={currency}
          today={today}
          expense={modal.expense}
          defaultDate={modal.expense.expense_date}
        />
      )}
      {modal?.kind === "limit" && (
        <LimitModal onClose={close} currency={currency} today={today} limits={data.limits} isSetup={modal.setup} />
      )}
      {modal?.kind === "deleteLimit" && (
        <DeleteLimitModal limit={modal.limit} limits={data.limits} currency={currency} onClose={close} />
      )}
    </div>
  );
}

function SetupCard({ onSetup, hasExpenses }: { onSetup: () => void; hasExpenses: boolean }) {
  return (
    <section className="glass-strong glass-edge animate-rise overflow-hidden rounded-3xl p-5 sm:p-7">
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,var(--aurora-3),transparent_70%)]" />
      <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-brand text-accent-fg shadow-glow">
            <CalendarDays className="relative h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-fg">Set your daily allowance</h2>
            <p className="mt-0.5 text-sm text-fg-muted">
              The allowance is added every day. Unused money carries forward, overspending carries
              forward as a negative balance, and each month starts again at zero.
            </p>
            {hasExpenses && (
              <p className="mt-1 text-xs text-fg-subtle">Your recorded expenses are kept.</p>
            )}
          </div>
        </div>
        <Button onClick={onSetup} className="w-full shrink-0 sm:w-auto" leftIcon={<Settings2 className="h-4 w-4" />}>
          Set daily limit
        </Button>
      </div>
    </section>
  );
}

function TodayOverview({
  currency,
  overview,
  onAdd,
}: {
  currency: SupportedCurrency;
  overview: ReturnType<typeof calculateDailyBudgetToday>;
  onAdd: () => void;
}) {
  const negative = overview.available < 0;
  return (
    <section aria-label="Today" className="glass-strong glass-edge animate-rise overflow-hidden rounded-3xl p-4 sm:p-7">
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,var(--aurora-3),transparent_70%)]" />
      <div className="relative flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
          <CalendarDays className="h-4 w-4 text-accent" />
          Today · {formatDayLabel(overview.date)}
        </span>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            !overview.started
              ? "border border-line bg-glass-hover text-fg-muted"
              : negative
                ? "bg-danger/12 text-danger"
                : "bg-positive/12 text-positive"
          )}
        >
          {!overview.started ? "Not started" : negative ? "Overspent" : "On track"}
        </span>
      </div>
      <p className={cn("relative mt-3 font-money text-[32px] font-bold leading-none tracking-tight sm:text-5xl", negative ? "text-danger" : "text-positive")}>
        {formatMoney(overview.available, currency)}
      </p>
      <p className="relative mt-2 text-xs text-fg-subtle">
        {overview.started
          ? negative
            ? "Overspent this month, after today's expenses"
            : "Available balance today, after today's expenses"
          : "Your daily budget starts on a later date"}
      </p>
      {overview.started && <TodayProgress allowance={overview.allowance} spent={overview.expenses} />}
      <dl className="relative mt-5 grid grid-cols-3 gap-2 sm:gap-3">
        <OverviewStat label="Carried in" value={signedMoney(overview.carried, currency)} className={tone(overview.carried)} />
        <OverviewStat label="Today's allowance" value={`+${formatMoney(overview.allowance, currency)}`} />
        <OverviewStat label="Spent today" value={formatMoney(overview.expenses, currency)} />
      </dl>
      <Button onClick={onAdd} className="relative mt-4 w-full sm:w-auto" leftIcon={<Plus className="h-4 w-4" />}>
        Add expense
      </Button>
    </section>
  );
}

function OverviewStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-glass-hover p-2.5 sm:p-4">
      <dt className="truncate text-[11px] font-medium text-fg-subtle">{label}</dt>
      <dd className={cn("mt-0.5 truncate font-money text-[13px] font-semibold text-fg sm:text-base", className)}>{value}</dd>
    </div>
  );
}

function MonthSummary({
  currency,
  totals,
  closed,
  hasDays,
}: {
  currency: SupportedCurrency;
  totals: ReturnType<typeof calculateDailyBudgetMonth>["totals"];
  closed: boolean;
  hasDays: boolean;
}) {
  if (!hasDays) return null;
  return (
    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      <SummaryTile label="Allowance allocated" value={formatMoney(totals.allowance, currency)} />
      <SummaryTile label="Expenses recorded" value={formatMoney(totals.expenses, currency)} />
      {totals.closing < 0 ? (
        <SummaryTile label="Overspent" value={formatMoney(totals.overspent, currency)} className="text-danger" />
      ) : (
        <SummaryTile label="Saved" value={formatMoney(totals.saved, currency)} className="text-positive" />
      )}
      <SummaryTile
        label={closed ? "Month-end balance" : "Balance so far"}
        value={signedMoney(totals.closing, currency)}
        className={tone(totals.closing)}
      />
    </dl>
  );
}

function SummaryTile({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-glass-hover p-3">
      <dt className="truncate text-[11px] font-medium text-fg-subtle">{label}</dt>
      <dd className={cn("mt-0.5 truncate font-money text-sm font-bold text-fg sm:text-base", className)}>{value}</dd>
    </div>
  );
}

function DayRow({
  day,
  today,
  currency,
  expenses,
  onAdd,
  onEdit,
}: {
  day: DailyBudgetDay;
  today: string;
  currency: SupportedCurrency;
  expenses: DailyExpenseRecord[];
  onAdd: () => void;
  onEdit: (expense: DailyExpenseRecord) => void;
}) {
  const [open, setOpen] = useState(day.date === today);
  const panelId = `day-${day.date}`;
  return (
    <li className="py-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-1.5 py-2 text-left transition-colors hover:bg-glass-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            {formatDayLabel(day.date)}
            {day.date === today && <span className="rounded-full bg-accent/12 px-1.5 py-px text-[10px] font-semibold text-accent">Today</span>}
            {!day.tracked && <span className="rounded-full bg-glass-hover px-1.5 py-px text-[10px] font-semibold text-fg-subtle">Before start</span>}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-fg-subtle">
            From {signedMoney(day.opening, currency)} · +{formatMoney(day.allowance, currency)} · −{formatMoney(day.expenses, currency)}
            {day.expenseCount > 0 ? ` (${day.expenseCount})` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("font-money text-sm font-bold", tone(day.closing))}>{signedMoney(day.closing, currency)}</p>
          <p className="text-[10px] text-fg-subtle">Closing</p>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div id={panelId} className="mb-2 ml-1.5 mr-1 animate-fade space-y-1.5 rounded-xl border border-line bg-glass-hover p-2">
          <dl className="grid grid-cols-4 gap-1 px-1 pb-1 text-[11px]">
            <DayFigure label="Previous" value={signedMoney(day.opening, currency)} />
            <DayFigure label="Allowance" value={formatMoney(day.allowance, currency)} />
            <DayFigure label="Expenses" value={formatMoney(day.expenses, currency)} />
            <DayFigure label="Closing" value={signedMoney(day.closing, currency)} className={tone(day.closing)} />
          </dl>
          {expenses.length === 0 ? (
            <p className="px-1 py-1 text-xs text-fg-subtle">No expenses recorded for this day.</p>
          ) : (
            <ul className="space-y-1">
              {expenses.map((expense) => (
                <li key={expense.id}>
                  <button
                    type="button"
                    onClick={() => onEdit(expense)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-glass-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                    aria-label={`Edit ${expense.description}, ${formatMoney(Number(expense.amount), currency)}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{expense.description}</span>
                    <span className="shrink-0 font-money text-sm font-semibold text-danger">
                      −{formatMoney(Number(expense.amount), currency)}
                    </span>
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onAdd}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-glass-input"
          >
            <Plus className="h-3.5 w-3.5" />
            Add expense on {formatDayLabel(day.date)}
          </button>
        </div>
      )}
    </li>
  );
}

function DayFigure({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-fg-subtle">{label}</dt>
      <dd className={cn("truncate font-money font-semibold text-fg", className)}>{value}</dd>
    </div>
  );
}

function LimitSettings({
  currency,
  today,
  limits,
  onChange,
  onDelete,
}: {
  currency: SupportedCurrency;
  today: string;
  limits: DailyLimitRecord[];
  onChange: () => void;
  onDelete: (limit: DailyLimitRecord) => void;
}) {
  const history = normalizeLimits(limits).reverse();
  const current = limitOn(limits, today);
  const upcoming = history.filter((limit) => limit.date > today).reverse()[0];
  return (
    <Card
      title="Daily limit"
      description="Each change applies from its date. Earlier days keep their limit."
      action={
        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2.5" onClick={onChange} leftIcon={<Pencil className="h-3.5 w-3.5" />}>
          Change
        </Button>
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium text-fg-subtle">Current limit</p>
          <p className="font-money text-xl font-bold text-fg">
            {current === null ? "Not started" : `${formatMoney(current, currency)} / day`}
          </p>
        </div>
        {upcoming && (
          <p className="text-xs text-fg-muted">
            {formatMoney(upcoming.cents / 100, currency)} / day from {formatDayLabel(upcoming.date, true)}
          </p>
        )}
      </div>
      <div className="mt-4">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          <History className="h-3.5 w-3.5" /> Change history
        </p>
        <ul className="mt-2 divide-y divide-line">
          {history.map((limit, index) => (
            <li key={limit.date} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">
                  From {formatDayLabel(limit.date, true)}
                  {index === history.length - 1 && <span className="ml-1.5 text-[11px] text-fg-subtle">(start)</span>}
                  {limit.date > today && <span className="ml-1.5 text-[11px] text-fg-subtle">(scheduled)</span>}
                </p>
              </div>
              <span className="font-money text-sm font-semibold text-fg">{formatMoney(limit.cents / 100, currency)}</span>
              <button
                type="button"
                onClick={() => onDelete({ effective_date: limit.date, amount: limit.cents / 100 })}
                aria-label={`Remove the limit change from ${formatDayLabel(limit.date, true)}`}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function DeleteLimitModal({
  limit,
  limits,
  currency,
  onClose,
}: {
  limit: DailyLimitRecord;
  limits: DailyLimitRecord[];
  currency: SupportedCurrency;
  onClose: () => void;
}) {
  const { run, isPending } = useDailyBudgetMutation();
  const [error, setError] = useState<string | null>(null);
  const remaining = limits.filter((entry) => entry.effective_date !== limit.effective_date);
  const previous = limitOn(remaining, limit.effective_date);
  const description =
    remaining.length === 0
      ? "This is your only limit, so the daily budget stops adding an allowance. Recorded expenses are kept."
      : previous === null
        ? "Tracking will start from the next limit change instead. Days before it get no allowance."
        : `Days from ${formatDayLabel(limit.effective_date, true)} use ${formatMoney(previous, currency)} again, including any past months they fall in.`;
  return (
    <ConfirmModal
      title="Remove this limit change?"
      description={description}
      confirmLabel={isPending ? "Removing…" : "Remove"}
      isPending={isPending}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        run(
          {
            local: (ownerId) => deleteDailyLimitLocally(ownerId, limit.effective_date),
            remote: () => deleteDailyLimitAction(limit.effective_date),
          },
          (outcome) => (outcome.success ? onClose() : setError(outcome.error ?? "Unable to remove this limit."))
        )
      }
    >
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-danger/25 bg-danger/8 p-3.5">
        <span className="text-sm font-medium text-fg-muted">From {formatDayLabel(limit.effective_date, true)}</span>
        <span className="font-money text-base font-bold text-fg">{formatMoney(Number(limit.amount), currency)}</span>
      </div>
    </ConfirmModal>
  );
}
