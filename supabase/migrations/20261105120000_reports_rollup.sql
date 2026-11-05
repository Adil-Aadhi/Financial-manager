begin;

-- Reports: one pre-aggregated row per (account, category, type, month) for the
-- signed-in user within [p_start, p_end] (both inclusive). Every report section
-- (overview, category breakdowns, monthly comparison, per-account totals) is
-- derived from these few rows, so individual transactions never leave the
-- database. Currency comes from the account and is resolved in the app, so
-- amounts in different currencies are never summed together here.
--
-- SECURITY INVOKER keeps the caller's RLS in force; the auth.uid() filter is an
-- extra guard so another user's rows can never be included.
create or replace function public.get_report_rollup(p_start date, p_end date)
returns table (
  account_id text,
  category_id text,
  type text,
  month date,
  total numeric,
  tx_count integer
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    t.account_id::text,
    t.category_id::text,
    t.type::text,
    pg_catalog.date_trunc('month', t.transaction_date::date)::date as month,
    sum(t.amount::numeric) as total,
    count(*)::integer as tx_count
  from public.transactions t
  where t.user_id = (select auth.uid())
    and t.transaction_date::date >= p_start
    and t.transaction_date::date <= p_end
  group by 1, 2, 3, 4;
$function$;

revoke all on function public.get_report_rollup(date, date) from public, anon;
grant execute on function public.get_report_rollup(date, date) to authenticated;

-- Range scans by user and date (all types). The monthly-budget migration added
-- a similar partial index for expenses only.
create index if not exists transactions_user_date_idx
on public.transactions (user_id, transaction_date);

commit;
