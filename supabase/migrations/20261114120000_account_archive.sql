begin;

-- Account archive: an archived account is hidden from the Transactions page and can't receive
-- new transactions, but its balance and history keep counting everywhere else (Home, Reports,
-- exports). Archiving is fully reversible (set archived_at back to null).
alter table public.accounts
add column if not exists archived_at timestamptz null;

-- Use database time when an account is archived; never trust or later change a client value.
create or replace function public.protect_account_archived_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.archived_at is null and new.archived_at is not null then
    new.archived_at := statement_timestamp();
  elsif old.archived_at is not null and new.archived_at is not null then
    new.archived_at := old.archived_at;
  end if;
  return new;
end;
$function$;

drop trigger if exists protect_account_archived_at on public.accounts;

create trigger protect_account_archived_at
before update of archived_at on public.accounts
for each row
execute function public.protect_account_archived_at();

-- New money movement needs an account that isn't archived: blocks inserts and moving an existing
-- transaction INTO an archived account. Editing or deleting a transaction that already belongs to
-- an archived account stays allowed. This also covers the Installments payment function, which
-- inserts its expense into public.transactions.
create or replace function public.prevent_transactions_on_archived_accounts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' or new.account_id is distinct from old.account_id then
    if exists (
      select 1
      from public.accounts a
      where a.id = new.account_id
        and a.archived_at is not null
    ) then
      raise exception 'This account is archived. Unarchive it to add transactions.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists prevent_transactions_on_archived_accounts on public.transactions;

create trigger prevent_transactions_on_archived_accounts
before insert or update of account_id on public.transactions
for each row
execute function public.prevent_transactions_on_archived_accounts();

commit;
