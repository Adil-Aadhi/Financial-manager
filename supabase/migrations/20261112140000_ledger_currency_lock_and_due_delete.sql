begin;

-- Personal Ledger follow-up. Safe to apply whether or not the earlier ledger migration already
-- contained these rules: every statement is create-or-replace, so nothing is dropped and no data
-- is changed. Existing privileges on the functions are kept.
--
--   1. A group's currency can't change once it has dues         (ledger_group_guard)
--   2. A due's currency can't change once it has payments       (ledger_save_obligation)
--   3. An expense's currency can't change once a share has a payment (ledger_save_expense)
--   4. A due added by mistake can be deleted while it has no payments, including a recurring
--      one (ledger_delete_obligation). Shared dues are still removed by editing their expense.

/* ------------------------------------------------------------------ preflight */

do $preflight$
begin
  if to_regclass('public.ledger_obligations') is null
     or to_regclass('public.ledger_payments') is null
     or to_regclass('public.ledger_expenses') is null
     or to_regclass('public.ledger_groups') is null then
    raise exception 'Personal Ledger follow-up: apply the Personal Ledger migration first.';
  end if;
end;
$preflight$;

/* ------------------------------------------------------------------ 1. group currency */

create or replace function public.ledger_group_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if (new.frequency, new.frequency_interval, new.start_date)
     is distinct from (old.frequency, old.frequency_interval, old.start_date)
     and exists (select 1 from public.ledger_obligations o where o.group_id = new.id) then
    raise exception 'This group already has dues, so its schedule can''t change.' using errcode = 'P0001';
  end if;
  if new.currency is distinct from old.currency
     and exists (select 1 from public.ledger_obligations o where o.group_id = new.id) then
    raise exception 'This group already has dues, so its currency can''t change.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- The trigger already exists from the earlier migration; make sure it does (idempotent).
drop trigger if exists ledger_group_guard on public.ledger_groups;
create trigger ledger_group_guard
before update on public.ledger_groups
for each row
execute function public.ledger_group_guard();

revoke all on function public.ledger_group_guard() from public, anon, authenticated;

/* ------------------------------------------------------------------ 2. due currency */

create or replace function public.ledger_save_obligation(
  p_id uuid,
  p_person_id uuid,
  p_source text,
  p_group_id uuid,
  p_member_id uuid,
  p_period_start date,
  p_title text,
  p_amount numeric,
  p_due_date date,
  p_currency text,
  p_note text,
  p_created_at timestamptz,
  p_edited_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.now();
  v_edited timestamptz := least(coalesce(p_edited_at, pg_catalog.now()), pg_catalog.now());
  v_old public.ledger_obligations%rowtype;
  v_has boolean;
  v_member record;
  v_title text := btrim(coalesce(p_title, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_user is null then
    raise exception 'Sign in again to save this due.' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('manual', 'recurring') then
    raise exception 'Shared dues are saved together with their expense.' using errcode = 'P0001';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 120 then
    raise exception 'Enter a title up to 120 characters.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 999999999999.99 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter a valid amount (up to two decimal places).' using errcode = 'P0001';
  end if;
  if p_due_date is null or p_due_date < date '2000-01-01' then
    raise exception 'Choose a valid due date.' using errcode = 'P0001';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'Choose a valid currency.' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'Keep notes under 300 characters.' using errcode = 'P0001';
  end if;

  select * into v_old from public.ledger_obligations where id = p_id for update;
  v_has := found;
  if v_has and v_old.user_id <> v_user then
    raise exception 'You don''t have permission to change this due.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.ledger_people pe where pe.id = p_person_id and pe.user_id = v_user) then
    raise exception 'Choose one of your people.' using errcode = 'P0001';
  end if;

  if p_source = 'recurring' then
    if p_member_id is null or p_group_id is null or p_period_start is null then
      raise exception 'A recurring due needs its group, member and period.' using errcode = 'P0001';
    end if;
    select m.group_id, m.person_id into v_member
    from public.ledger_members m
    where m.id = p_member_id and m.user_id = v_user;
    if not found then
      raise exception 'This member no longer exists.' using errcode = 'P0001';
    end if;
    if v_member.group_id <> p_group_id or v_member.person_id <> p_person_id then
      raise exception 'This due doesn''t match its member.' using errcode = 'P0001';
    end if;
  elsif p_member_id is not null or p_group_id is not null or p_period_start is not null then
    raise exception 'A manual due can''t belong to a group.' using errcode = 'P0001';
  end if;

  if v_has then
    if v_old.source <> p_source
       or v_old.person_id <> p_person_id
       or v_old.member_id is distinct from p_member_id
       or v_old.period_start is distinct from p_period_start then
      raise exception 'A due can''t change who or which period it is for.' using errcode = 'P0001';
    end if;
    -- Payments are recorded in the due's currency, so it is fixed once any exist.
    if v_old.currency <> p_currency
       and exists (select 1 from public.ledger_payments pay where pay.obligation_id = p_id) then
      raise exception 'This due already has payments, so its currency can''t change.' using errcode = 'P0001';
    end if;
    update public.ledger_obligations
    set title = v_title, amount = p_amount, due_date = p_due_date, currency = p_currency,
        note = v_note, updated_at = v_edited
    where id = p_id and user_id = v_user;
  else
    if p_source = 'recurring' and exists (
      select 1 from public.ledger_obligations o
      where o.member_id = p_member_id and o.period_start = p_period_start
    ) then
      raise exception 'This period already has a due.' using errcode = 'P0001';
    end if;
    insert into public.ledger_obligations (
      id, user_id, person_id, source, group_id, member_id, period_start, title, amount, due_date,
      currency, note, created_at, updated_at
    ) values (
      p_id, v_user, p_person_id, p_source, p_group_id, p_member_id, p_period_start, v_title, p_amount,
      p_due_date, p_currency, v_note, least(coalesce(p_created_at, v_edited), v_now), v_edited
    );
  end if;
end;
$function$;

/* ------------------------------------------------------------------ 3. expense currency */

create or replace function public.ledger_save_expense(
  p_id uuid,
  p_title text,
  p_description text,
  p_total numeric,
  p_date date,
  p_category text,
  p_allow_unallocated boolean,
  p_currency text,
  p_shares jsonb,
  p_created_at timestamptz,
  p_edited_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.now();
  v_edited timestamptz := least(coalesce(p_edited_at, pg_catalog.now()), pg_catalog.now());
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_old public.ledger_expenses%rowtype;
  v_has boolean;
  v_share record;
  v_sum numeric := 0;
  v_count integer := 0;
  v_distinct integer;
  v_ids uuid[] := array[]::uuid[];
  v_gone record;
begin
  if v_user is null then
    raise exception 'Sign in again to save this expense.' using errcode = '42501';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 120 then
    raise exception 'Enter a title up to 120 characters.' using errcode = 'P0001';
  end if;
  if v_description is not null and char_length(v_description) > 300 then
    raise exception 'Keep the description under 300 characters.' using errcode = 'P0001';
  end if;
  if v_category is not null and char_length(v_category) > 40 then
    raise exception 'Keep the category under 40 characters.' using errcode = 'P0001';
  end if;
  if p_total is null or p_total <= 0 or p_total > 999999999999.99 or p_total <> round(p_total, 2) then
    raise exception 'Enter a valid total (up to two decimal places).' using errcode = 'P0001';
  end if;
  if p_date is null or p_date < date '2000-01-01' then
    raise exception 'Choose a valid date.' using errcode = 'P0001';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'Choose a valid currency.' using errcode = 'P0001';
  end if;
  if p_shares is null or jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) < 1
     or jsonb_array_length(p_shares) > 100 then
    raise exception 'Add between 1 and 100 people to this expense.' using errcode = 'P0001';
  end if;

  select * into v_old from public.ledger_expenses where id = p_id for update;
  v_has := found;
  if v_has and v_old.user_id <> v_user then
    raise exception 'You don''t have permission to change this expense.' using errcode = '42501';
  end if;

  -- Validate every share before writing anything.
  for v_share in
    select (s ->> 'id')::uuid as id, (s ->> 'person_id')::uuid as person_id, (s ->> 'amount')::numeric as amount
    from jsonb_array_elements(p_shares) as s
  loop
    if v_share.id is null or v_share.person_id is null or v_share.amount is null
       or v_share.amount <= 0 or v_share.amount <> round(v_share.amount, 2) then
      raise exception 'Every person needs an amount greater than zero.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.ledger_people pe where pe.id = v_share.person_id and pe.user_id = v_user) then
      raise exception 'Choose one of your people.' using errcode = 'P0001';
    end if;
    v_sum := v_sum + v_share.amount;
    v_count := v_count + 1;
    v_ids := v_ids || v_share.id;
  end loop;
  select count(distinct (s ->> 'person_id')) into v_distinct from jsonb_array_elements(p_shares) as s;
  if v_distinct <> v_count then
    raise exception 'Each person can appear only once.' using errcode = 'P0001';
  end if;
  if v_sum > p_total then
    raise exception 'The shares add up to more than the total.' using errcode = 'P0001';
  end if;
  if v_sum < p_total and not coalesce(p_allow_unallocated, false) then
    raise exception 'The shares are % short of the total. Allocate it all or allow an unallocated balance.', (p_total - v_sum) using errcode = 'P0001';
  end if;

  if v_has then
    -- Shares are paid in the expense's currency, so it is fixed once any share has a payment.
    if v_old.currency <> p_currency and exists (
      select 1 from public.ledger_payments pay
      join public.ledger_obligations o on o.id = pay.obligation_id
      where o.expense_id = p_id
    ) then
      raise exception 'This expense already has payments, so its currency can''t change.' using errcode = 'P0001';
    end if;
    update public.ledger_expenses
    set title = v_title, description = v_description, total_amount = p_total, expense_date = p_date,
        category = v_category, allow_unallocated = coalesce(p_allow_unallocated, false),
        currency = p_currency, updated_at = v_edited
    where id = p_id and user_id = v_user;
  else
    insert into public.ledger_expenses (
      id, user_id, title, description, total_amount, expense_date, category, allow_unallocated,
      currency, created_at, updated_at
    ) values (
      p_id, v_user, v_title, v_description, p_total, p_date, v_category,
      coalesce(p_allow_unallocated, false), p_currency, least(coalesce(p_created_at, v_edited), v_now), v_edited
    );
  end if;

  -- Shares that were removed: only allowed while they have no payments.
  for v_gone in
    select o.id from public.ledger_obligations o
    where o.expense_id = p_id and o.user_id = v_user and not (o.id = any (v_ids))
  loop
    if exists (select 1 from public.ledger_payments p where p.obligation_id = v_gone.id) then
      raise exception 'A person with payments can''t be removed from this expense.' using errcode = 'P0001';
    end if;
    delete from public.ledger_obligations where id = v_gone.id and user_id = v_user;
  end loop;

  for v_share in
    select (s ->> 'id')::uuid as id, (s ->> 'person_id')::uuid as person_id, (s ->> 'amount')::numeric as amount
    from jsonb_array_elements(p_shares) as s
  loop
    if exists (select 1 from public.ledger_obligations o where o.id = v_share.id) then
      if not exists (
        select 1 from public.ledger_obligations o
        where o.id = v_share.id and o.user_id = v_user and o.expense_id = p_id and o.person_id = v_share.person_id
      ) then
        raise exception 'A share doesn''t belong to this expense.' using errcode = 'P0001';
      end if;
      update public.ledger_obligations
      set title = v_title, amount = v_share.amount, due_date = p_date, currency = p_currency, updated_at = v_edited
      where id = v_share.id and user_id = v_user;
    else
      insert into public.ledger_obligations (
        id, user_id, person_id, source, expense_id, title, amount, due_date, currency, created_at, updated_at
      ) values (
        v_share.id, v_user, v_share.person_id, 'shared', p_id, v_title, v_share.amount, p_date, p_currency,
        least(coalesce(p_created_at, v_edited), v_now), v_edited
      );
    end if;
  end loop;
end;
$function$;

/* ------------------------------------------------------------------ 4. delete a due */

-- Removes a manual or recurring due that has no payments (e.g. one added by mistake). Anything
-- with payment history is kept. A shared due is removed by editing its expense.
create or replace function public.ledger_delete_obligation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_old public.ledger_obligations%rowtype;
begin
  if v_user is null then
    raise exception 'Sign in again to change this due.' using errcode = '42501';
  end if;
  select * into v_old from public.ledger_obligations where id = p_id for update;
  if not found then
    return; -- already removed: a retried delete is a no-op
  end if;
  if v_old.user_id <> v_user then
    raise exception 'You don''t have permission to change this due.' using errcode = '42501';
  end if;
  if v_old.source = 'shared' then
    raise exception 'A shared due is removed by editing its expense.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.ledger_payments p where p.obligation_id = p_id) then
    raise exception 'This due has payments, so it is kept for the history.' using errcode = 'P0001';
  end if;
  delete from public.ledger_obligations where id = p_id and user_id = v_user;
end;
$function$;

/* ------------------------------------------------------------------ privileges */

-- create or replace keeps these, but stating them makes the migration self-contained.
revoke all on function public.ledger_save_obligation(uuid, uuid, text, uuid, uuid, date, text, numeric, date, text, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.ledger_delete_obligation(uuid) from public, anon;
revoke all on function public.ledger_save_expense(uuid, text, text, numeric, date, text, boolean, text, jsonb, timestamptz, timestamptz) from public, anon;
grant execute on function public.ledger_save_obligation(uuid, uuid, text, uuid, uuid, date, text, numeric, date, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.ledger_delete_obligation(uuid) to authenticated;
grant execute on function public.ledger_save_expense(uuid, text, text, numeric, date, text, boolean, text, jsonb, timestamptz, timestamptz) to authenticated;

commit;
