begin;

-- Existing and newly created accounts participate in consolidated financial
-- summaries unless the user explicitly opts out. If the column was created
-- manually before this migration, preserve false values and repair only nulls.
alter table public.accounts
add column if not exists include_in_summary boolean default true;

update public.accounts
set include_in_summary = true
where include_in_summary is null;

alter table public.accounts
alter column include_in_summary set default true,
alter column include_in_summary set not null;

-- Monthly budget spending is a consolidated calculation. Excluded accounts
-- remain queryable everywhere else, including their account detail pages.
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
    and a.include_in_summary is true
    and t.type = 'expense'
    and t.transaction_date >= (p_month_start::timestamp at time zone 'Asia/Kolkata')
    and t.transaction_date < (p_month_end::timestamp at time zone 'Asia/Kolkata');
$function$;

revoke all on function public.get_monthly_expense_summary(date, date, text) from public, anon;
grant execute on function public.get_monthly_expense_summary(date, date, text) to authenticated;

commit;
