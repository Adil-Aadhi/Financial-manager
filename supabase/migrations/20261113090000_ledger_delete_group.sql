begin;

-- Personal Ledger follow-up: delete a recurring group that was created by mistake.
--
-- A group with members has already generated dues, and those can't be deleted one by one (a
-- generated due would be created again). Deleting the whole group removes the source of those
-- dues, so it is safe, but only while nothing under it has payment history:
--
--   * any payment on any of the group's dues, voided ones included  -> refused, keep the history
--     (deactivate the group instead);
--   * otherwise the group's dues, members, contribution history and membership periods are
--     removed together with the group, in one transaction.
--
-- Ownership is checked against the signed-in user. Nothing else is changed.
--
-- Concurrency. Inserting a payment makes PostgreSQL's foreign-key check take a FOR KEY SHARE lock
-- on the obligation row it references, and ledger_payment_guard takes FOR UPDATE on it. The delete
-- below locks every obligation of the group FOR UPDATE *before* it looks for payments. FOR UPDATE
-- is the one row-lock mode that conflicts with FOR KEY SHARE (FOR NO KEY UPDATE would not), so:
--   * a payment still being inserted holds its lock until it commits: the delete waits, then its
--     payment-history check (a new statement, so it sees that payment) refuses the delete;
--   * a payment that starts after the delete has locked the rows waits for the delete; once the
--     delete commits the obligation is gone and the payment is refused ("This due no longer exists").
-- Either way a payment is never inserted under a due that is being deleted, and no payment row is
-- ever orphaned. As a last line of defence the foreign key is ON DELETE RESTRICT, so a payment that
-- somehow existed would make the delete fail and roll back as a whole.

do $preflight$
begin
  if to_regclass('public.ledger_groups') is null
     or to_regclass('public.ledger_obligations') is null
     or to_regclass('public.ledger_payments') is null then
    raise exception 'Ledger delete group: apply the Personal Ledger migrations first.';
  end if;
end;
$preflight$;

create or replace function public.ledger_delete_group(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_group public.ledger_groups%rowtype;
begin
  if v_user is null then
    raise exception 'Sign in again to change this group.' using errcode = '42501';
  end if;
  select * into v_group from public.ledger_groups where id = p_id for update;
  if not found then
    return; -- already removed: a retried delete is a no-op
  end if;
  if v_group.user_id <> v_user then
    raise exception 'You don''t have permission to change this group.' using errcode = '42501';
  end if;

  -- Lock all obligations before checking payment history.
  -- This prevents concurrent payment inserts from passing their
  -- foreign-key checks while the group deletion is in progress.
  perform o.id
  from public.ledger_obligations o
  where o.group_id = p_id
    and o.user_id = v_user
  order by o.id
  for update;

  if exists (
    select 1
    from public.ledger_payments p
    join public.ledger_obligations o on o.id = p.obligation_id
    where o.group_id = p_id
      and o.user_id = v_user
  ) then
    raise exception 'This group has payments, so it is kept for the history. Deactivate it instead.'
      using errcode = 'P0001';
  end if;

  -- Dues first (they restrict deleting their members), then the group, which removes its members,
  -- their contribution history and their membership periods. All of it is one transaction: if any
  -- statement fails, nothing is deleted.
  delete from public.ledger_obligations where group_id = p_id and user_id = v_user;
  delete from public.ledger_groups where id = p_id and user_id = v_user;
end;
$function$;

revoke all on function public.ledger_delete_group(uuid) from public, anon;
grant execute on function public.ledger_delete_group(uuid) to authenticated;

commit;
