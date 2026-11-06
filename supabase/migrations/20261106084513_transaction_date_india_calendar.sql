begin;

-- transaction_date is a date-only business value in the India calendar, but
-- the existing column is timestamptz and Supabase/PostgREST serializes it in
-- UTC. Convert to Asia/Kolkata only at the calendar boundary; do not rewrite
-- any existing transaction rows.
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
    and t.transaction_date >= (p_month_start::timestamp at time zone 'Asia/Kolkata')
    and t.transaction_date < (p_month_end::timestamp at time zone 'Asia/Kolkata');
$function$;

revoke all on function public.get_monthly_expense_summary(date, date, text) from public, anon;
grant execute on function public.get_monthly_expense_summary(date, date, text) to authenticated;

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
    pg_catalog.date_trunc(
      'month',
      (t.transaction_date at time zone 'Asia/Kolkata')::date
    )::date as month,
    sum(t.amount::numeric) as total,
    count(*)::integer as tx_count
  from public.transactions t
  where t.user_id = (select auth.uid())
    and t.transaction_date >= (p_start::timestamp at time zone 'Asia/Kolkata')
    and t.transaction_date < ((p_end + 1)::timestamp at time zone 'Asia/Kolkata')
  group by 1, 2, 3, 4;
$function$;

revoke all on function public.get_report_rollup(date, date) from public, anon;
grant execute on function public.get_report_rollup(date, date) to authenticated;

commit;
