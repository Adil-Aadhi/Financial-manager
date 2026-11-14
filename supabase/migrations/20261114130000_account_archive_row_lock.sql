begin;

-- Serialize "add a transaction" with "archive the account".
--
-- Without a lock, the two can race: inserting a transaction takes only FOR KEY SHARE on the
-- account row (the foreign-key check), and archiving takes FOR NO KEY UPDATE (archived_at is not
-- a key column). Those locks don't conflict, so an insert could read archived_at = null while a
-- concurrent archive commits, and a new transaction would land in a just-archived account.
--
-- FOR SHARE conflicts with FOR NO KEY UPDATE, so:
--   * archive first  -> the insert waits for it to commit, then re-reads the row (READ COMMITTED
--     returns the newest locked version) and is rejected;
--   * insert first   -> the archive waits until the insert commits, then archives.
-- FOR SHARE (not FOR UPDATE) because FOR UPDATE would also queue every concurrent insert into the
-- same account behind each other. FOR SHARE locks don't conflict with each other or with the
-- foreign key's FOR KEY SHARE.
--
-- RLS: the function stays SECURITY INVOKER. A row-locking SELECT needs the caller's SELECT and
-- UPDATE policies on accounts; users already pass both for their own accounts (they edit them).
-- If the row isn't visible (someone else's account), nothing is locked or blocked here; the
-- transactions insert policy already rejects that case. SECURITY DEFINER callers (the
-- Installments payment function, owned by a BYPASSRLS role) see and lock the row normally.
--
-- OLD is only read on UPDATE (nested IF), never on INSERT.
create or replace function public.prevent_transactions_on_archived_accounts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_archived_at timestamptz;
  v_check boolean := false;
begin
  if tg_op = 'INSERT' then
    v_check := true;
  elsif tg_op = 'UPDATE' then
    if new.account_id is distinct from old.account_id then
      v_check := true;
    end if;
  end if;

  if v_check and new.account_id is not null then
    select a.archived_at
    into v_archived_at
    from public.accounts a
    where a.id = new.account_id
    for share;

    if v_archived_at is not null then
      raise exception 'This account is archived. Unarchive it to add transactions.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$function$;

-- The trigger itself is unchanged (before insert or update of account_id); recreate it so this
-- migration also works on its own.
drop trigger if exists prevent_transactions_on_archived_accounts on public.transactions;

create trigger prevent_transactions_on_archived_accounts
before insert or update of account_id on public.transactions
for each row
execute function public.prevent_transactions_on_archived_accounts();

commit;
