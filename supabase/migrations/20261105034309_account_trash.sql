begin;

-- Mark accounts as active (null) or in Trash (timestamp).
alter table public.accounts
add column if not exists deleted_at timestamptz null;

create index if not exists accounts_deleted_at_idx
on public.accounts (deleted_at)
where deleted_at is not null;

-- Use database time when an active account first enters Trash. Once set, the
-- timestamp cannot be backdated, postponed, or otherwise changed. Setting it
-- to null restores the account only during its 10-day retention period.
create or replace function public.protect_account_deleted_at()
returns trigger
language plpgsql
security invoker
as $function$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    new.deleted_at := statement_timestamp();
  elsif old.deleted_at is not null and new.deleted_at is null then
    if old.deleted_at <= statement_timestamp() - interval '10 days' then
      raise exception
        'This account cannot be restored because its 10-day retention period has expired.';
    end if;
  elsif old.deleted_at is not null and new.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;

  return new;
end;
$function$;

drop trigger if exists protect_account_deleted_at on public.accounts;

create trigger protect_account_deleted_at
before update of deleted_at on public.accounts
for each row
execute function public.protect_account_deleted_at();

-- Account deletion is now a soft delete performed with UPDATE. Keep every
-- other account policy and privilege unchanged.
drop policy if exists "Users can delete own accounts" on public.accounts;
revoke delete, truncate on table public.accounts from anon, authenticated;

-- Replace only the account_id foreign key when it is not already CASCADE.
-- Moving an account to Trash does not touch its transactions; the cascade runs
-- only when Cron permanently deletes the expired account.
do $migration$
declare
  account_fk_name name;
  account_fk_delete_action text;
begin
  select c.conname, c.confdeltype::text
  into account_fk_name, account_fk_delete_action
  from pg_catalog.pg_constraint c
  where c.contype = 'f'
    and c.conrelid = 'public.transactions'::regclass
    and c.confrelid = 'public.accounts'::regclass
    and c.conkey = array[
      (
        select a.attnum
        from pg_catalog.pg_attribute a
        where a.attrelid = 'public.transactions'::regclass
          and a.attname = 'account_id'
          and not a.attisdropped
      )
    ]::smallint[];

  if account_fk_name is null then
    raise exception 'Could not find transactions.account_id foreign key';
  end if;

  if account_fk_delete_action <> 'c' then
    execute pg_catalog.format(
      'alter table public.transactions drop constraint %I',
      account_fk_name
    );

    execute pg_catalog.format(
      'alter table public.transactions add constraint %I '
      'foreign key (account_id) references public.accounts (id) '
      'on delete cascade',
      account_fk_name
    );
  end if;
end;
$migration$;

-- Supabase Cron runs this database-side cleanup hourly. CREATE EXTENSION is
-- safe when pg_cron is already enabled. Scheduling the same case-sensitive job
-- name updates that job instead of creating a duplicate.
create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'purge-trashed-accounts',
  '17 * * * *',
  $cron$
    delete from public.accounts
    where deleted_at is not null
      and deleted_at <= now() - interval '10 days';
  $cron$
);

commit;
