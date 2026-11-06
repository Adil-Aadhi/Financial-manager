begin;

-- Daily Budget Tracker: an independent, manual daily allowance. It never reads or writes
-- accounts, transactions, categories or monthly_budgets.
--
-- Balances are not stored. Every day's balance is derived from these two tables:
--   closing(day) = closing(previous day in the same month) + allowance(day) - expenses(day)
-- and each calendar month starts again from zero. allowance(day) is the amount of the latest
-- limit whose effective_date <= day, so changing the limit never rewrites earlier days, and a
-- late expense only changes the month it is dated in.

-- Limit history. The earliest row is when tracking starts. One row per user per effective
-- date, so a day can never accrue two allowances.
create table if not exists public.daily_budget_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  effective_date date not null,
  amount numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_budget_limits_user_date_key unique (user_id, effective_date),
  constraint daily_budget_limits_amount_check
    check (amount >= 0 and amount <= 999999999999.99),
  constraint daily_budget_limits_date_check
    check (effective_date >= date '2000-01-01' and effective_date <= date '2100-12-31')
);

-- Manually recorded daily-budget expenses. The id is generated on the device so an offline
-- entry keeps the same id when it syncs (resending it can never create a duplicate).
create table if not exists public.daily_budget_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  expense_date date not null,
  amount numeric(14, 2) not null,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_budget_expenses_amount_check
    check (amount > 0 and amount <= 999999999999.99),
  constraint daily_budget_expenses_description_check
    check (char_length(btrim(description)) between 1 and 120),
  constraint daily_budget_expenses_date_check
    check (expense_date >= date '2000-01-01' and expense_date <= date '2100-12-31')
);

-- Month and day lookups for one user.
create index if not exists daily_budget_expenses_user_date_idx
on public.daily_budget_expenses (user_id, expense_date);

-- updated_at is written by the app (the device's edit time, used for last-write-wins during
-- offline sync), so there is deliberately no trigger overwriting it.

-- Row level security: each user can only see and change their own rows.
alter table public.daily_budget_limits enable row level security;
alter table public.daily_budget_expenses enable row level security;

drop policy if exists "Users can view own daily budget limits" on public.daily_budget_limits;
drop policy if exists "Users can create own daily budget limits" on public.daily_budget_limits;
drop policy if exists "Users can update own daily budget limits" on public.daily_budget_limits;
drop policy if exists "Users can delete own daily budget limits" on public.daily_budget_limits;

create policy "Users can view own daily budget limits"
on public.daily_budget_limits
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Users can create own daily budget limits"
on public.daily_budget_limits
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update own daily budget limits"
on public.daily_budget_limits
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users can delete own daily budget limits"
on public.daily_budget_limits
for delete
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can view own daily budget expenses" on public.daily_budget_expenses;
drop policy if exists "Users can create own daily budget expenses" on public.daily_budget_expenses;
drop policy if exists "Users can update own daily budget expenses" on public.daily_budget_expenses;
drop policy if exists "Users can delete own daily budget expenses" on public.daily_budget_expenses;

create policy "Users can view own daily budget expenses"
on public.daily_budget_expenses
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Users can create own daily budget expenses"
on public.daily_budget_expenses
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update own daily budget expenses"
on public.daily_budget_expenses
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users can delete own daily budget expenses"
on public.daily_budget_expenses
for delete
to authenticated
using (user_id = (select auth.uid()));

revoke all privileges on table public.daily_budget_limits from anon;
revoke all privileges on table public.daily_budget_expenses from anon;
grant select, insert, update, delete on table public.daily_budget_limits to authenticated;
grant select, insert, update, delete on table public.daily_budget_expenses to authenticated;

commit;
