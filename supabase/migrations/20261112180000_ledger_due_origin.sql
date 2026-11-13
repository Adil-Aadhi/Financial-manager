begin;

-- Personal Ledger follow-up: an explicit, database-enforced "origin" for every due, so that
-- deletion rules don't depend on guesswork.
--
-- Until now a recurring due created by the monthly generator, an earlier unpaid period added by
-- hand and a future period created by "Receive" extra payments were all stored identically
-- (source = 'recurring'), so ledger_delete_obligation could not tell them apart and allowed every
-- recurring due without payments to be deleted. A generated due that is deleted is simply created
-- again, so that was wrong.
--
-- ledger_obligations.origin
--   manual      added by hand                                          deletable (no payments)
--   shared      one person's share of a shared expense                 never deletable on its own
--   generated   created by the app for a billing period in the run     NOT deletable
--   earlier     earlier unpaid period added before the group started   deletable (no payments)
--   advance     future period created by "Receive" extra payments      deletable while the period
--                                                                      is still in the future
--
-- Deleting any due that has a payment, voided ones included, is refused whatever its origin.
--
-- Safe to apply on top of the earlier ledger migrations. The original migrations are not touched.
-- Existing rows are backfilled: manual and shared by type; a recurring due is 'earlier' when its
-- period starts before its group's start date (or it was added as an earlier period), 'advance'
-- when it was added as a paid-in-advance period, and 'generated' otherwise.

/* ------------------------------------------------------------------ preflight */

do $preflight$
begin
  if to_regclass('public.ledger_obligations') is null
     or to_regclass('public.ledger_payments') is null
     or to_regclass('public.ledger_expenses') is null
     or to_regclass('public.ledger_groups') is null then
    raise exception 'Ledger origin migration: apply the Personal Ledger migrations first.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.ledger_obligations'::regclass and a.attname = 'origin' and not a.attisdropped
  ) then
    raise exception 'Ledger origin migration: ledger_obligations.origin already exists (applied before?).';
  end if;
  if to_regprocedure('public.ledger_delete_obligation(uuid)') is null
     or to_regprocedure('public.ledger_save_obligation(uuid, uuid, text, uuid, uuid, date, text, numeric, date, text, text, timestamptz, timestamptz)') is null
     or to_regprocedure('public.ledger_save_expense(uuid, text, text, numeric, date, text, boolean, text, jsonb, timestamptz, timestamptz)') is null then
    raise exception 'Ledger origin migration: the ledger functions are missing.';
  end if;
end;
$preflight$;

/* ------------------------------------------------------------------ column */

alter table public.ledger_obligations add column origin text;

-- Backfill. (ledger_obligation_guard fires only on updates of amount, so this doesn't trigger it.)
update public.ledger_obligations o
set origin = case
  when o.source = 'manual' then 'manual'
  when o.source = 'shared' then 'shared'
  when o.period_start < (select g.start_date from public.ledger_groups g where g.id = o.group_id)
       or o.note = 'Earlier unpaid period' then 'earlier'
  when o.note = 'Paid in advance' then 'advance'
  else 'generated'
end;

alter table public.ledger_obligations alter column origin set not null;

alter table public.ledger_obligations
  add constraint ledger_obligations_origin_check
  check (origin in ('manual', 'shared', 'generated', 'earlier', 'advance'));

-- The origin must fit the type of due.
alter table public.ledger_obligations
  add constraint ledger_obligations_origin_shape_check
  check (
    (source = 'manual' and origin = 'manual')
    or (source = 'shared' and origin = 'shared')
    or (source = 'recurring' and origin in ('generated', 'earlier', 'advance'))
  );

/* ------------------------------------------------------------------ save a due */

-- The new signature adds p_origin, so the old one is dropped first: leaving both would make named
-- calls ambiguous. p_origin may be omitted or null (changes queued by an older app version carry
-- none); the origin is then worked out from the data exactly as the backfill does, using
-- the India calendar for "future". When given it is validated against the group's start date.
drop function if exists public.ledger_save_obligation(uuid, uuid, text, uuid, uuid, date, text, numeric, date, text, text, timestamptz, timestamptz);

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
  p_edited_at timestamptz,
  p_origin text default null
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
  v_today date := (pg_catalog.now() at time zone 'Asia/Kolkata')::date;
  v_old public.ledger_obligations%rowtype;
  v_has boolean;
  v_member record;
  v_group_start date;
  v_origin text;
  v_title text := btrim(coalesce(p_title, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_user is null then
    raise exception 'Sign in again to save this due.' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('manual', 'recurring') then
    raise exception 'Shared dues are saved together with their expense.' using errcode = 'P0001';
  end if;
  if p_origin is not null and p_origin not in ('manual', 'generated', 'earlier', 'advance') then
    raise exception 'Choose a valid due type.' using errcode = 'P0001';
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
    select g.start_date into v_group_start
    from public.ledger_groups g
    where g.id = p_group_id and g.user_id = v_user;
    if not found then
      raise exception 'This group no longer exists.' using errcode = 'P0001';
    end if;
  elsif p_member_id is not null or p_group_id is not null or p_period_start is not null then
    raise exception 'A manual due can''t belong to a group.' using errcode = 'P0001';
  end if;

  -- The origin: fixed once a due exists; for a new one, given or worked out, then validated.
  if v_has then
    v_origin := v_old.origin;
    if p_origin is not null and p_origin <> v_old.origin then
      raise exception 'A due''s type can''t change.' using errcode = 'P0001';
    end if;
  else
    -- Same order and meaning as the backfill above, so a change queued by an older app version
    -- (no origin) gets the origin the backfill would have given the same row. Besides the dates,
    -- the two exact legacy notes those versions wrote are recognised; a period in the future
    -- (India calendar) is an advance period. The validation below applies to a derived origin too.
    v_origin := coalesce(
      p_origin,
      case
        when p_source = 'manual' then 'manual'
        when p_period_start < v_group_start or v_note = 'Earlier unpaid period' then 'earlier'
        when v_note = 'Paid in advance' or p_period_start > v_today then 'advance'
        else 'generated'
      end
    );
    if p_source = 'manual' and v_origin <> 'manual' then
      raise exception 'A manual due must have the manual type.' using errcode = 'P0001';
    end if;
    if p_source = 'recurring' then
      if v_origin = 'manual' then
        raise exception 'A recurring due can''t have the manual type.' using errcode = 'P0001';
      end if;
      if v_origin = 'earlier' and p_period_start >= v_group_start then
        raise exception 'An earlier period must start before the group does.' using errcode = 'P0001';
      end if;
      -- An advance due sent as such must be for a genuinely future period (India calendar): one
      -- that has started, or starts today, is an ordinary period. Only an origin the caller states
      -- is held to this; an older change that carried just the "Paid in advance" note keeps being
      -- classified like the backfill does it, and such a due can't be deleted once its period started.
      if v_origin = 'advance' and p_origin is not null and p_period_start <= v_today then
        raise exception 'An advance due must be for a period in the future.' using errcode = 'P0001';
      end if;
      if v_origin in ('generated', 'advance') and p_period_start < v_group_start then
        raise exception 'This period starts before the group does, so it is an earlier period.' using errcode = 'P0001';
      end if;
    end if;
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
      id, user_id, person_id, source, origin, group_id, member_id, period_start, title, amount, due_date,
      currency, note, created_at, updated_at
    ) values (
      p_id, v_user, p_person_id, p_source, v_origin, p_group_id, p_member_id, p_period_start, v_title, p_amount,
      p_due_date, p_currency, v_note, least(coalesce(p_created_at, v_edited), v_now), v_edited
    );
  end if;
end;
$function$;

/* ------------------------------------------------------------------ save an expense */

-- Identical to the previous version except that the shares it creates are marked origin 'shared'
-- (the column is now required). Currency protection, ownership and share rules are unchanged.
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
        id, user_id, person_id, source, origin, expense_id, title, amount, due_date, currency, created_at, updated_at
      ) values (
        v_share.id, v_user, v_share.person_id, 'shared', 'shared', p_id, v_title, v_share.amount, p_date, p_currency,
        least(coalesce(p_created_at, v_edited), v_now), v_edited
      );
    end if;
  end loop;
end;
$function$;

/* ------------------------------------------------------------------ delete a due */

-- The rules, checked in this order (the first that applies refuses the delete):
--   1. a shared due is removed by editing its expense;
--   2. a due with any payment, voided ones included, is kept for the history;
--   3. a generated due is kept: the app would create it again;
--   4. an advance due whose period has started is now an ordinary period: kept.
-- Everything else is deleted: manual dues, earlier-period dues and advance dues for periods that
-- are still in the future. "Started" uses the India calendar, like the rest of the app.
create or replace function public.ledger_delete_obligation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_today date := (pg_catalog.now() at time zone 'Asia/Kolkata')::date;
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
  if v_old.origin = 'shared' then
    raise exception 'A shared due is removed by editing its expense.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.ledger_payments p where p.obligation_id = p_id) then
    raise exception 'This due has payments, so it is kept for the history.' using errcode = 'P0001';
  end if;
  if v_old.origin = 'generated' then
    raise exception 'This period is created automatically, so deleting it would bring it back. Pause the member or edit its amount instead.' using errcode = 'P0001';
  end if;
  if v_old.origin = 'advance' and v_old.period_start <= v_today then
    raise exception 'This period has started, so it is now generated automatically and can''t be deleted. Pause the member or edit its amount instead.' using errcode = 'P0001';
  end if;
  delete from public.ledger_obligations where id = p_id and user_id = v_user;
end;
$function$;

/* ------------------------------------------------------------------ privileges */

-- Same privileges as before: only signed-in users can call the write functions.
revoke all on function public.ledger_save_obligation(uuid, uuid, text, uuid, uuid, date, text, numeric, date, text, text, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.ledger_save_expense(uuid, text, text, numeric, date, text, boolean, text, jsonb, timestamptz, timestamptz) from public, anon;
revoke all on function public.ledger_delete_obligation(uuid) from public, anon;
grant execute on function public.ledger_save_obligation(uuid, uuid, text, uuid, uuid, date, text, numeric, date, text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.ledger_save_expense(uuid, text, text, numeric, date, text, boolean, text, jsonb, timestamptz, timestamptz) to authenticated;
grant execute on function public.ledger_delete_obligation(uuid) to authenticated;

commit;
