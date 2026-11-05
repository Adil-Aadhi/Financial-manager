begin;

-- One overall monthly spending limit per user. The limit carries over from
-- month to month; spending is always calculated from the current month's
-- expense transactions, so no per-month rows are stored.
create table if not exists public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  amount numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_budgets_user_id_key unique (user_id),
  constraint monthly_budgets_amount_check
    check (amount > 0 and amount <= 999999999999.99)
);

-- Keep updated_at accurate on every edit.
create or replace function public.set_monthly_budget_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;

drop trigger if exists set_monthly_budget_updated_at on public.monthly_budgets;

create trigger set_monthly_budget_updated_at
before update on public.monthly_budgets
for each row
execute function public.set_monthly_budget_updated_at();

-- Row level security: each user can only see and change their own budget.
alter table public.monthly_budgets enable row level security;

drop policy if exists "Users can view own monthly budget" on public.monthly_budgets;
drop policy if exists "Users can create own monthly budget" on public.monthly_budgets;
drop policy if exists "Users can update own monthly budget" on public.monthly_budgets;
drop policy if exists "Users can delete own monthly budget" on public.monthly_budgets;

create policy "Users can view own monthly budget"
on public.monthly_budgets
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Users can create own monthly budget"
on public.monthly_budgets
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update own monthly budget"
on public.monthly_budgets
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users can delete own monthly budget"
on public.monthly_budgets
for delete
to authenticated
using (user_id = (select auth.uid()));

revoke all privileges on table public.monthly_budgets from anon;
grant select, insert, update, delete on table public.monthly_budgets to authenticated;

-- Supports the monthly expense total for one user without scanning every row.
create index if not exists transactions_user_expense_date_idx
on public.transactions (user_id, transaction_date)
where type = 'expense';

-- Sum of the signed-in user's expenses in [p_month_start, p_month_end),
-- across every account (active or in Trash). Only expenses from accounts in
-- p_currency (or with no currency set) are summed so the total matches the
-- budget's currency; expenses in other currencies are counted separately.
-- SECURITY INVOKER keeps the caller's RLS in force; the auth.uid() filter is
-- an extra guard so another user's rows can never be included.
create or replace function public.get_monthly_expense_summary(
  p_month_start date,
  p_month_end date,
  p_currency text
)
returns table (total_spent numeric, other_currency_count integer)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    coalesce(
      sum(t.amount::numeric) filter (
        where coalesce(a.currency, p_currency) = p_currency
      ),
      0
    )::numeric as total_spent,
    (
      count(*) filter (
        where coalesce(a.currency, p_currency) <> p_currency
      )
    )::integer as other_currency_count
  from public.transactions t
  left join public.accounts a on a.id = t.account_id
  where t.user_id = (select auth.uid())
    and t.type = 'expense'
    and t.transaction_date::date >= p_month_start
    and t.transaction_date::date < p_month_end;
$function$;

revoke all on function public.get_monthly_expense_summary(date, date, text) from public, anon;
grant execute on function public.get_monthly_expense_summary(date, date, text) to authenticated;

commit;
