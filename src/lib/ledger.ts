import { addDays, isDateKey, roundAmount, toCents } from "@/lib/dailyBudget";

/**
 * Personal Ledger: money other people owe the user.
 *
 * Pure rules shared by the device (offline writes) and the server (sync apply): types, input
 * normalisation, balance maths in integer cents, and the recurring schedule. The ledger never
 * reads or writes accounts, transactions, categories or reports.
 */

/* ------------------------------------------------------------------ types */

export type LedgerFrequency = "weekly" | "monthly" | "yearly" | "custom_days" | "custom_months";
export type LedgerSource = "recurring" | "shared" | "manual";
export type LedgerEndReason = "paused" | "left";

/**
 * Why a due exists. Stored on every obligation and checked by the database:
 *   manual      added by hand                                        deletable (no payments)
 *   shared      one person's share of a shared expense               not deletable on its own
 *   generated   created by the app for a billing period in the run    NOT deletable (it would be recreated)
 *   earlier     an earlier unpaid period added before the group start deletable (no payments)
 *   advance     a future period created by "Receive" extra payments   deletable while the period is in the future
 */
export type LedgerOrigin = "manual" | "shared" | "generated" | "earlier" | "advance";
export const LEDGER_ORIGINS: readonly LedgerOrigin[] = ["manual", "shared", "generated", "earlier", "advance"];
export const isLedgerOrigin = (value: unknown): value is LedgerOrigin => typeof value === "string" && (LEDGER_ORIGINS as readonly string[]).includes(value);

export interface LedgerPersonRecord {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface LedgerGroupRecord {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  frequency: LedgerFrequency;
  frequency_interval: number;
  start_date: string;
  due_offset_days: number;
  is_active: boolean;
  currency: string;
  created_at: string;
  updated_at: string | null;
}

export interface LedgerMemberRecord {
  id: string;
  user_id: string;
  group_id: string;
  person_id: string;
  joined_on: string;
  created_at: string;
  updated_at: string | null;
}

export interface LedgerRateRecord {
  id: string;
  user_id: string;
  member_id: string;
  effective_from: string;
  amount: number | string;
  created_at: string;
  updated_at: string | null;
}

export interface LedgerSpanRecord {
  id: string;
  user_id: string;
  member_id: string;
  from_date: string;
  to_date: string | null;
  end_reason: LedgerEndReason | null;
  created_at: string;
  updated_at: string | null;
}

export interface LedgerExpenseRecord {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  total_amount: number | string;
  expense_date: string;
  category: string | null;
  allow_unallocated: boolean;
  currency: string;
  created_at: string;
  updated_at: string | null;
}

export interface LedgerObligationRecord {
  id: string;
  user_id: string;
  person_id: string;
  source: LedgerSource;
  /** Missing only on rows cached before the origin column existed; read it with dueOrigin(). */
  origin?: LedgerOrigin;
  group_id: string | null;
  member_id: string | null;
  period_start: string | null;
  expense_id: string | null;
  title: string;
  amount: number | string;
  due_date: string;
  currency: string;
  note: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface LedgerPaymentRecord {
  id: string;
  user_id: string;
  obligation_id: string;
  amount: number | string;
  paid_on: string;
  note: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface LedgerRows {
  people: LedgerPersonRecord[];
  groups: LedgerGroupRecord[];
  members: LedgerMemberRecord[];
  rates: LedgerRateRecord[];
  spans: LedgerSpanRecord[];
  expenses: LedgerExpenseRecord[];
  obligations: LedgerObligationRecord[];
  payments: LedgerPaymentRecord[];
}

export const EMPTY_LEDGER_ROWS: LedgerRows = {
  people: [],
  groups: [],
  members: [],
  rates: [],
  spans: [],
  expenses: [],
  obligations: [],
  payments: [],
};

/** Outbox / sync entity names. Each maps to one table (an expense also carries its shares). */
export const LEDGER_ENTITIES = [
  "ledger_person",
  "ledger_group",
  "ledger_member",
  "ledger_rate",
  "ledger_span",
  "ledger_expense",
  "ledger_obligation",
  "ledger_payment",
] as const;
export type LedgerEntity = (typeof LEDGER_ENTITIES)[number];

export function isLedgerEntity(value: unknown): value is LedgerEntity {
  return typeof value === "string" && (LEDGER_ENTITIES as readonly string[]).includes(value);
}

export type LedgerOperation = "CREATE" | "UPDATE" | "DELETE";

/** One change to the ledger: what the forms produce and what both the device and server apply. */
export interface LedgerChange {
  entity: LedgerEntity;
  op: LedgerOperation;
  id: string;
  payload: Record<string, unknown>;
}

/** Fired by the global add button on /ledger pages. */
export const LEDGER_ADD_EVENT = "account-tracker:ledger-add";

/** Columns kept on the device and read from the server, per table. */
export const LEDGER_COLUMNS = {
  ledger_people: "id, user_id, name, phone, notes, archived_at, created_at, updated_at",
  ledger_groups:
    "id, user_id, name, description, frequency, frequency_interval, start_date, due_offset_days, is_active, currency, created_at, updated_at",
  ledger_members: "id, user_id, group_id, person_id, joined_on, created_at, updated_at",
  ledger_member_rates: "id, user_id, member_id, effective_from, amount, created_at, updated_at",
  ledger_member_spans: "id, user_id, member_id, from_date, to_date, end_reason, created_at, updated_at",
  ledger_expenses:
    "id, user_id, title, description, total_amount, expense_date, category, allow_unallocated, currency, created_at, updated_at",
  ledger_obligations:
    "id, user_id, person_id, source, origin, group_id, member_id, period_start, expense_id, title, amount, due_date, currency, note, created_at, updated_at",
  ledger_payments: "id, user_id, obligation_id, amount, paid_on, note, voided_at, created_at, updated_at",
} as const;

/** Before the origin migration is applied the column doesn't exist; the app then reads this instead. */
export const LEDGER_OBLIGATION_LEGACY_COLUMNS =
  "id, user_id, person_id, source, group_id, member_id, period_start, expense_id, title, amount, due_date, currency, note, created_at, updated_at";

export const LEDGER_FREQUENCIES: Array<{ value: LedgerFrequency; label: string }> = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom_days", label: "Every N days" },
  { value: "custom_months", label: "Every N months" },
];

export const MAX_LEDGER_AMOUNT_CENTS = 99_999_999_999_999; // 999,999,999,999.99

/* ------------------------------------------------------------------ small helpers */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isLedgerUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const isCurrency = (value: unknown): value is string => typeof value === "string" && /^[A-Z]{3}$/.test(value);

function validDate(value: unknown): value is string {
  return isDateKey(value) && value >= "2000-01-01";
}

function validAmount(value: unknown) {
  const amount = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return false;
  const cents = Math.round(amount * 100);
  return Math.abs(amount * 100 - cents) < 1e-6 && cents <= MAX_LEDGER_AMOUNT_CENTS;
}

export const isLedgerFrequency = (value: unknown): value is LedgerFrequency =>
  LEDGER_FREQUENCIES.some((item) => item.value === value);

export function ledgerFrequencyLabel(frequency: LedgerFrequency, interval = 1) {
  if (frequency === "custom_days") return `Every ${interval} day${interval === 1 ? "" : "s"}`;
  if (frequency === "custom_months") return `Every ${interval} month${interval === 1 ? "" : "s"}`;
  return LEDGER_FREQUENCIES.find((item) => item.value === frequency)?.label ?? "Monthly";
}

/** Splits a total into `parts` shares in cents; the remainder goes to the first shares. */
export function splitEqually(totalCents: number, parts: number) {
  if (parts <= 0) return [];
  const base = Math.floor(totalCents / parts);
  const extra = totalCents - base * parts;
  return Array.from({ length: parts }, (_, index) => base + (index < extra ? 1 : 0));
}

/* ------------------------------------------------------------------ normalisation */

export type Normalized = { ok: true; columns: Record<string, unknown> } | { ok: false; error: string };
const fail = (error: string): Normalized => ({ ok: false, error });

export function normalizePerson(source: Record<string, unknown>): Normalized {
  const name = text(source.name);
  const phone = text(source.phone);
  const notes = text(source.notes);
  if (name.length < 1 || name.length > 80) return fail("Enter a name up to 80 characters.");
  if (phone.length > 30 || !/^[0-9+()\-\s]*$/.test(phone)) return fail("Enter a valid phone number.");
  if (notes.length > 300) return fail("Keep notes under 300 characters.");
  const archived = source.archived_at;
  if (archived != null && (typeof archived !== "string" || Number.isNaN(Date.parse(archived)))) return fail("Invalid archive date.");
  return { ok: true, columns: { name, phone: phone || null, notes: notes || null, archived_at: (archived as string | null) ?? null } };
}

export function normalizeGroup(source: Record<string, unknown>): Normalized {
  const name = text(source.name);
  const description = text(source.description);
  const frequency = source.frequency;
  const custom = frequency === "custom_days" || frequency === "custom_months";
  const interval = custom ? Number(source.frequency_interval) : 1;
  const offset = Number(source.due_offset_days ?? 0);
  if (name.length < 1 || name.length > 80) return fail("Enter a group name up to 80 characters.");
  if (description.length > 200) return fail("Keep the description under 200 characters.");
  if (!isLedgerFrequency(frequency)) return fail("Choose how often people pay.");
  if (custom) {
    const max = frequency === "custom_days" ? 3650 : 120;
    if (!Number.isInteger(interval) || interval < 1 || interval > max) return fail(`Enter a repeat interval from 1 to ${max}.`);
  }
  if (!validDate(source.start_date)) return fail("Choose a valid start date.");
  if (!Number.isInteger(offset) || offset < 0 || offset > 365) return fail("Due days must be from 0 to 365.");
  if (!isCurrency(source.currency)) return fail("Choose a valid currency.");
  return {
    ok: true,
    columns: {
      name,
      description: description || null,
      frequency,
      frequency_interval: interval,
      start_date: source.start_date,
      due_offset_days: offset,
      is_active: source.is_active === undefined ? true : source.is_active === true,
      currency: source.currency,
    },
  };
}

export function normalizeMember(source: Record<string, unknown>): Normalized {
  if (!isLedgerUuid(source.group_id) || !isLedgerUuid(source.person_id)) return fail("Choose a person for this group.");
  if (!validDate(source.joined_on)) return fail("Choose a valid joining date.");
  return { ok: true, columns: { group_id: source.group_id, person_id: source.person_id, joined_on: source.joined_on } };
}

export function normalizeRate(source: Record<string, unknown>): Normalized {
  if (!isLedgerUuid(source.member_id)) return fail("This contribution has no member.");
  if (!validDate(source.effective_from)) return fail("Choose a valid start date for the new amount.");
  if (!validAmount(source.amount)) return fail("Enter a contribution greater than zero (up to two decimal places).");
  return { ok: true, columns: { member_id: source.member_id, effective_from: source.effective_from, amount: roundAmount(Number(source.amount)) } };
}

export function normalizeSpan(source: Record<string, unknown>): Normalized {
  if (!isLedgerUuid(source.member_id)) return fail("This span has no member.");
  if (!validDate(source.from_date)) return fail("Choose a valid date.");
  const to = source.to_date ?? null;
  const reason = source.end_reason ?? null;
  if (to !== null) {
    if (!validDate(to) || to <= source.from_date) return fail("The end date must be after the start date.");
    if (reason !== "paused" && reason !== "left") return fail("Choose whether the member paused or left.");
  } else if (reason !== null) {
    return fail("An open period can't have an end reason.");
  }
  return { ok: true, columns: { member_id: source.member_id, from_date: source.from_date, to_date: to, end_reason: reason } };
}

export function normalizeObligation(source: Record<string, unknown>): Normalized {
  const title = text(source.title);
  const note = text(source.note);
  const kind = source.source;
  if (kind !== "manual" && kind !== "recurring") return fail("Choose a valid due type.");
  if (!isLedgerUuid(source.person_id)) return fail("Choose who owes this.");
  if (title.length < 1 || title.length > 120) return fail("Enter a description up to 120 characters.");
  if (!validAmount(source.amount)) return fail("Enter an amount greater than zero (up to two decimal places).");
  if (!validDate(source.due_date)) return fail("Choose a valid due date.");
  if (!isCurrency(source.currency)) return fail("Choose a valid currency.");
  if (note.length > 300) return fail("Keep notes under 300 characters.");
  if (kind === "recurring") {
    if (!isLedgerUuid(source.group_id) || !isLedgerUuid(source.member_id) || !validDate(source.period_start)) {
      return fail("A recurring due needs its group, member and period.");
    }
  } else if (source.group_id || source.member_id || source.period_start) {
    return fail("A manual due can't belong to a group.");
  }
  // The origin is optional (older queued changes have none; the database then works it out), but
  // when given it must fit the type: manual dues are "manual", recurring ones generated/earlier/advance.
  const origin = source.origin ?? null;
  if (origin !== null) {
    if (!isLedgerOrigin(origin) || origin === "shared") return fail("Invalid due type.");
    if ((kind === "manual") !== (origin === "manual")) return fail("Invalid due type.");
  }
  return {
    ok: true,
    columns: {
      person_id: source.person_id,
      source: kind,
      ...(origin ? { origin } : {}),
      group_id: kind === "recurring" ? source.group_id : null,
      member_id: kind === "recurring" ? source.member_id : null,
      period_start: kind === "recurring" ? source.period_start : null,
      title,
      amount: roundAmount(Number(source.amount)),
      due_date: source.due_date,
      currency: source.currency,
      note: note || null,
    },
  };
}

export interface LedgerShare {
  id: string;
  person_id: string;
  amount: number;
}

export function normalizeExpense(source: Record<string, unknown>): Normalized {
  const title = text(source.title);
  const description = text(source.description);
  const category = text(source.category);
  const allowUnallocated = source.allow_unallocated === true;
  if (title.length < 1 || title.length > 120) return fail("Enter a title up to 120 characters.");
  if (description.length > 300) return fail("Keep the description under 300 characters.");
  if (category.length > 40) return fail("Keep the category under 40 characters.");
  if (!validAmount(source.total_amount)) return fail("Enter a total greater than zero (up to two decimal places).");
  if (!validDate(source.expense_date)) return fail("Choose a valid date.");
  if (!isCurrency(source.currency)) return fail("Choose a valid currency.");
  const rawShares = Array.isArray(source.shares) ? (source.shares as Array<Record<string, unknown>>) : [];
  if (rawShares.length < 1 || rawShares.length > 100) return fail("Add at least one person to this expense.");
  const shares: LedgerShare[] = [];
  const seen = new Set<string>();
  for (const share of rawShares) {
    if (!isLedgerUuid(share?.id) || !isLedgerUuid(share?.person_id)) return fail("A person on this expense is invalid.");
    if (!validAmount(share.amount)) return fail("Every person needs an amount greater than zero.");
    if (seen.has(share.person_id)) return fail("Each person can appear only once.");
    seen.add(share.person_id);
    shares.push({ id: share.id, person_id: share.person_id, amount: roundAmount(Number(share.amount)) });
  }
  const totalCents = toCents(source.total_amount as number);
  const allocatedCents = shares.reduce((sum, share) => sum + toCents(share.amount), 0);
  if (allocatedCents > totalCents) return fail("The shares add up to more than the total.");
  if (allocatedCents < totalCents && !allowUnallocated) {
    return fail(`The shares are ${((totalCents - allocatedCents) / 100).toFixed(2)} short of the total. Allocate it all or allow an unallocated balance.`);
  }
  return {
    ok: true,
    columns: {
      title,
      description: description || null,
      total_amount: totalCents / 100,
      expense_date: source.expense_date,
      category: category || null,
      allow_unallocated: allowUnallocated,
      currency: source.currency,
      shares,
    },
  };
}

export function normalizePayment(source: Record<string, unknown>): Normalized {
  const note = text(source.note);
  if (!isLedgerUuid(source.obligation_id)) return fail("Choose the due this payment is for.");
  if (!validAmount(source.amount)) return fail("Enter an amount greater than zero (up to two decimal places).");
  if (!validDate(source.paid_on)) return fail("Choose a valid payment date.");
  if (note.length > 300) return fail("Keep notes under 300 characters.");
  const voided = source.voided_at ?? null;
  if (voided !== null && (typeof voided !== "string" || Number.isNaN(Date.parse(voided)))) return fail("Invalid void date.");
  return {
    ok: true,
    columns: {
      obligation_id: source.obligation_id,
      amount: roundAmount(Number(source.amount)),
      paid_on: source.paid_on,
      note: note || null,
      voided_at: voided,
    },
  };
}

export const LEDGER_NORMALIZERS: Record<LedgerEntity, (source: Record<string, unknown>) => Normalized> = {
  ledger_person: normalizePerson,
  ledger_group: normalizeGroup,
  ledger_member: normalizeMember,
  ledger_rate: normalizeRate,
  ledger_span: normalizeSpan,
  ledger_expense: normalizeExpense,
  ledger_obligation: normalizeObligation,
  ledger_payment: normalizePayment,
};

/* ------------------------------------------------------------------ balances */

export type LedgerStatus = "paid" | "pending" | "partial" | "overdue";

export interface ObligationBalance {
  id: string;
  amountCents: number;
  paidCents: number;
  outstandingCents: number;
  status: LedgerStatus;
  /** Something has been paid but not everything (shown next to "overdue" too). */
  partial: boolean;
  lastPaidOn: string | null;
}

export function obligationBalance(
  obligation: Pick<LedgerObligationRecord, "id" | "amount" | "due_date">,
  payments: LedgerPaymentRecord[],
  today: string
): ObligationBalance {
  const amountCents = toCents(obligation.amount);
  let paidCents = 0;
  let lastPaidOn: string | null = null;
  for (const payment of payments) {
    if (payment.voided_at) continue;
    paidCents += toCents(payment.amount);
    if (!lastPaidOn || payment.paid_on > lastPaidOn) lastPaidOn = payment.paid_on;
  }
  const outstandingCents = Math.max(0, amountCents - paidCents);
  const partial = paidCents > 0 && outstandingCents > 0;
  const status: LedgerStatus =
    outstandingCents === 0 ? "paid" : obligation.due_date < today ? "overdue" : partial ? "partial" : "pending";
  return { id: obligation.id, amountCents, paidCents, outstandingCents, status, partial, lastPaidOn };
}

export function statusLabel(balance: Pick<ObligationBalance, "status" | "partial">) {
  if (balance.status === "overdue") return balance.partial ? "Overdue · part paid" : "Overdue";
  return { paid: "Paid", pending: "Pending", partial: "Partially paid" }[balance.status];
}

/* ------------------------------------------------------------------ recurring schedule */

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/** Adds calendar months to a date, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addCalendarMonths(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = total % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${pad(targetYear, 4)}-${pad(targetMonth + 1)}-${pad(Math.min(day, lastDay))}`;
}

/** Start date of billing period `index` (0 = the group's start date). Always counted from the start date. */
export function periodStartAt(
  group: Pick<LedgerGroupRecord, "frequency" | "frequency_interval" | "start_date">,
  index: number
) {
  switch (group.frequency) {
    case "weekly":
      return addDays(group.start_date, 7 * index);
    case "custom_days":
      return addDays(group.start_date, group.frequency_interval * index);
    case "yearly":
      return addCalendarMonths(group.start_date, 12 * index);
    case "custom_months":
      return addCalendarMonths(group.start_date, group.frequency_interval * index);
    default:
      return addCalendarMonths(group.start_date, index);
  }
}

/** Safety cap on how many periods one group can generate in one pass. */
export const MAX_GENERATED_PERIODS = 600;

/** Every period start from the group's start date up to and including `today`. */
export function periodStartsThrough(
  group: Pick<LedgerGroupRecord, "frequency" | "frequency_interval" | "start_date">,
  today: string,
  cap = MAX_GENERATED_PERIODS
) {
  const starts: string[] = [];
  for (let index = 0; index < cap; index += 1) {
    const start = periodStartAt(group, index);
    if (start > today) break;
    starts.push(start);
  }
  return starts;
}

/** How many upcoming periods a single payment may be put toward. */
export const MAX_ADVANCE_PERIODS = 12;

export interface MemberPaymentApplication {
  obligationId: string;
  amountCents: number;
  periodStart: string;
  /** A period that hasn't started yet: its due is created together with this payment. */
  upcoming: boolean;
  newDue?: { amount: number; dueDate: string };
}

export interface MemberPaymentPlan {
  applications: MemberPaymentApplication[];
  /** Money that couldn't be applied (more than every due and every allowed upcoming period). */
  unappliedCents: number;
}

/**
 * Spreads one payment from a group member over what they owe, oldest period first. Each due
 * receives at most what is still owed on it, so no single due is ever overpaid. Anything left over
 * can go toward upcoming periods: their dues are created at the member's rate for that period and
 * paid (the last one may be only part paid). Upcoming periods that already exist are covered by the
 * first step, and a period is never created twice.
 */
export function planMemberPayment(input: {
  group: LedgerGroupRecord;
  member: LedgerMemberRecord;
  spans: LedgerSpanRecord[];
  rates: LedgerRateRecord[];
  obligations: LedgerObligationRecord[];
  balances: Map<string, ObligationBalance>;
  amountCents: number;
  today: string;
  advance: boolean;
}): MemberPaymentPlan {
  let remaining = Math.max(0, Math.trunc(input.amountCents));
  const applications: MemberPaymentApplication[] = [];
  const own = input.obligations.filter((obligation) => obligation.member_id === input.member.id);

  const owed = own
    .map((obligation) => ({ obligation, balance: input.balances.get(obligation.id) }))
    .filter((item) => item.balance && item.balance.outstandingCents > 0)
    .sort((a, b) => (a.obligation.period_start ?? "").localeCompare(b.obligation.period_start ?? ""));
  for (const { obligation, balance } of owed) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, balance!.outstandingCents);
    applications.push({ obligationId: obligation.id, amountCents: take, periodStart: obligation.period_start ?? "", upcoming: false });
    remaining -= take;
  }

  if (remaining > 0 && input.advance) {
    const existing = new Set(own.map((obligation) => obligation.period_start));
    let created = 0;
    for (let index = 0; index < 2_000 && created < MAX_ADVANCE_PERIODS && remaining > 0; index += 1) {
      const start = periodStartAt(input.group, index);
      if (start <= input.today || existing.has(start)) continue;
      if (!memberActiveOn(input.spans, input.member.id, start)) continue;
      const rate = rateOn(input.rates, input.member.id, start);
      if (!rate) continue;
      const rateCents = toCents(rate.amount);
      const take = Math.min(remaining, rateCents);
      applications.push({
        obligationId: recurringObligationId(input.member.id, start),
        amountCents: take,
        periodStart: start,
        upcoming: true,
        newDue: { amount: rateCents / 100, dueDate: dueDateForPeriod(input.group, start) },
      });
      remaining -= take;
      created += 1;
    }
  }
  return { applications, unappliedCents: remaining };
}

/** How many earlier periods can be added to a member in one go. */
export const MAX_EARLIER_PERIODS = 24;

/**
 * Dues for periods before the group's starting date, for a person who already owed those
 * periods before tracking began. They are ordinary recurring dues (same member and period rules,
 * the same deterministic id) so they appear under their own month in the group, are paid like any
 * other due, and are never duplicated. Periods in `skip` (member|period already present) are left out.
 */
export function earlierDueChanges(input: {
  group: Pick<LedgerGroupRecord, "id" | "name" | "frequency" | "frequency_interval" | "start_date" | "due_offset_days" | "currency">;
  memberId: string;
  personId: string;
  count: number;
  amount: number;
  existingPeriods?: Set<string>;
}): LedgerChange[] {
  const changes: LedgerChange[] = [];
  const count = Math.min(Math.max(0, Math.trunc(input.count)), MAX_EARLIER_PERIODS);
  for (let back = 1; back <= count; back += 1) {
    const start = periodStartAt(input.group, -back);
    if (start < "2000-01-01" || input.existingPeriods?.has(start)) continue;
    changes.push({
      entity: "ledger_obligation",
      op: "CREATE",
      id: recurringObligationId(input.memberId, start),
      payload: {
        person_id: input.personId,
        source: "recurring",
        origin: "earlier",
        group_id: input.group.id,
        member_id: input.memberId,
        period_start: start,
        title: input.group.name,
        amount: input.amount,
        due_date: dueDateForPeriod(input.group, start),
        currency: input.group.currency,
        note: "Earlier unpaid period",
      },
    });
  }
  return changes;
}

export function periodLabel(
  group: Pick<LedgerGroupRecord, "frequency">,
  periodStart: string
) {
  const [year, month, day] = periodStart.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (group.frequency === "monthly") {
    return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  }
  if (group.frequency === "yearly") return String(year);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function formatLedgerDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

export function dueDateForPeriod(group: Pick<LedgerGroupRecord, "due_offset_days">, periodStart: string) {
  return addDays(periodStart, group.due_offset_days);
}

/** Is the member active on this date? A span covers [from_date, to_date). */
export function memberActiveOn(spans: LedgerSpanRecord[], memberId: string, date: string) {
  return spans.some((span) => span.member_id === memberId && span.from_date <= date && (span.to_date === null || date < span.to_date));
}

/** The member's contribution in force on a date: the latest rate that started on or before it. */
export function rateOn(rates: LedgerRateRecord[], memberId: string, date: string) {
  let best: LedgerRateRecord | null = null;
  for (const rate of rates) {
    if (rate.member_id !== memberId || rate.effective_from > date) continue;
    if (!best || rate.effective_from > best.effective_from) best = rate;
  }
  return best;
}

export type MemberStatus = "active" | "paused" | "left";

export function memberStatus(spans: LedgerSpanRecord[], memberId: string): MemberStatus {
  const own = spans.filter((span) => span.member_id === memberId);
  if (own.some((span) => span.to_date === null)) return "active";
  const last = [...own].sort((a, b) => (a.to_date ?? "").localeCompare(b.to_date ?? "")).at(-1);
  return last?.end_reason === "left" ? "left" : "paused";
}

/* deterministic ids: the same period always gets the same id, on every device */

function hash128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** A UUID derived from the member and period, so two devices create the same row, never two. */
export function recurringObligationId(memberId: string, periodStart: string) {
  const hex = hash128(`ledger-recurring:${memberId.toLowerCase()}:${periodStart}`)
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * A due's origin. Rows saved by the origin-aware app and database carry it. Rows cached before that
 * (no origin) are read the way the migration backfills them: manual and shared by type; a recurring
 * due is "earlier" before its group's start date or when it was added as one, "advance" when added
 * as one, and otherwise "generated".
 */
export function dueOrigin(
  obligation: Pick<LedgerObligationRecord, "source" | "origin" | "group_id" | "period_start" | "note">,
  groups: LedgerGroupRecord[]
): LedgerOrigin {
  if (obligation.origin) return obligation.origin;
  if (obligation.source === "manual") return "manual";
  if (obligation.source === "shared") return "shared";
  const group = groups.find((item) => item.id === obligation.group_id);
  if ((group && obligation.period_start && obligation.period_start < group.start_date) || obligation.note === "Earlier unpaid period") return "earlier";
  if (obligation.note === "Paid in advance") return "advance";
  return "generated";
}

export const AUTO_GENERATED_DELETE_MESSAGE =
  "This period is created automatically, so deleting it would bring it back. Pause the member or edit its amount instead.";
export const ADVANCE_STARTED_DELETE_MESSAGE =
  "This period has started, so it is now generated automatically and can't be deleted. Pause the member or edit its amount instead.";
export const SHARED_DELETE_MESSAGE = "A shared due is removed by editing its expense.";
export const PAYMENTS_DELETE_MESSAGE = "This due has payments, so it is kept for the history.";

/**
 * Why a due can't be deleted, or null when it can. The database enforces the same rules in
 * ledger_delete_obligation:
 *   - shared dues are never deleted on their own;
 *   - a due with any payment, voided ones included, is kept for the history;
 *   - a "generated" due is kept (it would be recreated);
 *   - an "advance" due can be deleted only while its period is still in the future;
 *   - manual and "earlier" dues without payments can be deleted.
 */
export function dueDeleteBlock(input: {
  obligation: Pick<LedgerObligationRecord, "source" | "origin" | "group_id" | "period_start" | "note">;
  groups: LedgerGroupRecord[];
  hasPayments: boolean;
  today?: string;
}): string | null {
  const origin = dueOrigin(input.obligation, input.groups);
  if (origin === "shared") return SHARED_DELETE_MESSAGE;
  if (input.hasPayments) return PAYMENTS_DELETE_MESSAGE;
  if (origin === "generated") return AUTO_GENERATED_DELETE_MESSAGE;
  if (origin === "advance" && input.today && (input.obligation.period_start ?? "") <= input.today) return ADVANCE_STARTED_DELETE_MESSAGE;
  return null;
}

export interface MissingObligation {
  id: string;
  groupId: string;
  memberId: string;
  personId: string;
  periodStart: string;
  dueDate: string;
  amount: number;
  title: string;
  currency: string;
}

/**
 * The obligations that should exist but don't yet: one per active member per billing period up to
 * today. A period is generated once: it is skipped when an obligation for that member and period
 * (or that deterministic id) already exists. The amount is the member's rate in force at the start
 * of the period, so changing a contribution later never touches earlier periods. Paused or left
 * members get no obligation for periods that start outside an active span.
 */
export function missingRecurringObligations(input: {
  groups: LedgerGroupRecord[];
  members: LedgerMemberRecord[];
  spans: LedgerSpanRecord[];
  rates: LedgerRateRecord[];
  obligations: LedgerObligationRecord[];
  today: string;
}): MissingObligation[] {
  const existingIds = new Set(input.obligations.map((obligation) => obligation.id));
  const existingPeriods = new Set(
    input.obligations.filter((obligation) => obligation.member_id && obligation.period_start).map((obligation) => `${obligation.member_id}|${obligation.period_start}`)
  );
  const missing: MissingObligation[] = [];
  for (const group of input.groups) {
    if (!group.is_active) continue;
    const starts = periodStartsThrough(group, input.today);
    if (starts.length === 0) continue;
    for (const member of input.members) {
      if (member.group_id !== group.id) continue;
      for (const start of starts) {
        if (!memberActiveOn(input.spans, member.id, start)) continue;
        const rate = rateOn(input.rates, member.id, start);
        if (!rate) continue;
        const id = recurringObligationId(member.id, start);
        if (existingIds.has(id) || existingPeriods.has(`${member.id}|${start}`)) continue;
        missing.push({
          id,
          groupId: group.id,
          memberId: member.id,
          personId: member.person_id,
          periodStart: start,
          dueDate: dueDateForPeriod(group, start),
          amount: Number(rate.amount),
          title: group.name,
          currency: group.currency,
        });
      }
    }
  }
  return missing;
}

/* ------------------------------------------------------------------ read model */

export interface PersonSummary {
  outstandingCents: number;
  collectedCents: number;
  totalCents: number;
  obligationCount: number;
  activeMemberships: number;
}

export interface GroupSummary {
  outstandingCents: number;
  collectedCents: number;
  activeMembers: number;
  obligationCount: number;
}

export interface ExpenseSummary {
  allocatedCents: number;
  unallocatedCents: number;
  outstandingCents: number;
  collectedCents: number;
}

export interface LedgerActivity {
  id: string;
  kind: "payment" | "due";
  personId: string;
  obligationId: string;
  amountCents: number;
  title: string;
  date: string;
  at: string;
}

export interface LedgerModel {
  balances: Map<string, ObligationBalance>;
  paymentsByObligation: Map<string, LedgerPaymentRecord[]>;
  obligationsByPerson: Map<string, LedgerObligationRecord[]>;
  personSummaries: Map<string, PersonSummary>;
  groupSummaries: Map<string, GroupSummary>;
  expenseSummaries: Map<string, ExpenseSummary>;
  overview: {
    outstandingCents: number;
    overdueCents: number;
    collectedCents: number;
    peopleCount: number;
    activeGroups: number;
    otherCurrencyDues: number;
    recent: LedgerActivity[];
  };
}

const emptyPerson = (): PersonSummary => ({ outstandingCents: 0, collectedCents: 0, totalCents: 0, obligationCount: 0, activeMemberships: 0 });

/**
 * Everything the pages show, derived from the rows in one pass. Only obligations in `currency`
 * count towards totals; amounts in other currencies are never mixed in.
 */
export function buildLedgerModel(rows: LedgerRows, today: string, currency: string): LedgerModel {
  const paymentsByObligation = new Map<string, LedgerPaymentRecord[]>();
  for (const payment of rows.payments) {
    const list = paymentsByObligation.get(payment.obligation_id);
    if (list) list.push(payment);
    else paymentsByObligation.set(payment.obligation_id, [payment]);
  }

  const balances = new Map<string, ObligationBalance>();
  const obligationsByPerson = new Map<string, LedgerObligationRecord[]>();
  const personSummaries = new Map<string, PersonSummary>();
  const groupSummaries = new Map<string, GroupSummary>();
  const expenseSummaries = new Map<string, ExpenseSummary>();
  let outstandingCents = 0;
  let overdueCents = 0;
  let collectedCents = 0;
  let otherCurrencyDues = 0;

  for (const group of rows.groups) {
    groupSummaries.set(group.id, { outstandingCents: 0, collectedCents: 0, activeMembers: 0, obligationCount: 0 });
  }
  for (const person of rows.people) personSummaries.set(person.id, emptyPerson());
  for (const expense of rows.expenses) {
    expenseSummaries.set(expense.id, { allocatedCents: 0, unallocatedCents: toCents(expense.total_amount), outstandingCents: 0, collectedCents: 0 });
  }

  for (const member of rows.members) {
    if (memberStatus(rows.spans, member.id) !== "active") continue;
    const group = groupSummaries.get(member.group_id);
    if (group) group.activeMembers += 1;
    const person = personSummaries.get(member.person_id);
    if (person) person.activeMemberships += 1;
  }

  for (const obligation of rows.obligations) {
    const balance = obligationBalance(obligation, paymentsByObligation.get(obligation.id) ?? [], today);
    balances.set(obligation.id, balance);
    const list = obligationsByPerson.get(obligation.person_id);
    if (list) list.push(obligation);
    else obligationsByPerson.set(obligation.person_id, [obligation]);

    if (obligation.source === "shared" && obligation.expense_id) {
      const expense = expenseSummaries.get(obligation.expense_id);
      if (expense) {
        expense.allocatedCents += balance.amountCents;
        expense.unallocatedCents -= balance.amountCents;
        expense.outstandingCents += balance.outstandingCents;
        expense.collectedCents += balance.paidCents;
      }
    }

    if (obligation.currency !== currency) {
      otherCurrencyDues += 1;
      continue;
    }
    outstandingCents += balance.outstandingCents;
    collectedCents += balance.paidCents;
    if (balance.status === "overdue") overdueCents += balance.outstandingCents;

    const person = personSummaries.get(obligation.person_id) ?? emptyPerson();
    person.outstandingCents += balance.outstandingCents;
    person.collectedCents += balance.paidCents;
    person.totalCents += balance.amountCents;
    person.obligationCount += 1;
    personSummaries.set(obligation.person_id, person);

    if (obligation.group_id) {
      const group = groupSummaries.get(obligation.group_id);
      if (group) {
        group.outstandingCents += balance.outstandingCents;
        group.collectedCents += balance.paidCents;
        group.obligationCount += 1;
      }
    }
  }

  const obligationById = new Map(rows.obligations.map((obligation) => [obligation.id, obligation]));
  const recent: LedgerActivity[] = [];
  for (const payment of rows.payments) {
    if (payment.voided_at) continue;
    const obligation = obligationById.get(payment.obligation_id);
    if (!obligation) continue;
    recent.push({
      id: payment.id,
      kind: "payment",
      personId: obligation.person_id,
      obligationId: obligation.id,
      amountCents: toCents(payment.amount),
      title: obligation.title,
      date: payment.paid_on,
      at: payment.created_at,
    });
  }
  for (const obligation of rows.obligations) {
    if (obligation.source === "recurring") continue;
    recent.push({
      id: obligation.id,
      kind: "due",
      personId: obligation.person_id,
      obligationId: obligation.id,
      amountCents: toCents(obligation.amount),
      title: obligation.title,
      date: obligation.due_date,
      at: obligation.created_at,
    });
  }
  recent.sort((a, b) => b.at.localeCompare(a.at));

  return {
    balances,
    paymentsByObligation,
    obligationsByPerson,
    personSummaries,
    groupSummaries,
    expenseSummaries,
    overview: {
      outstandingCents,
      overdueCents,
      collectedCents,
      peopleCount: rows.people.filter((person) => !person.archived_at).length,
      activeGroups: rows.groups.filter((group) => group.is_active).length,
      otherCurrencyDues,
      recent: recent.slice(0, 8),
    },
  };
}
