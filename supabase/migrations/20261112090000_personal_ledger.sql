begin;

-- Personal Ledger: money other people owe the user. Completely independent of accounts,
-- transactions, categories, budgets and reports: no table below references any of them.
--
-- Model
--   ledger_people          reusable people (archived, never deleted, once they have history)
--   ledger_groups          recurring contribution groups (e.g. "Spotify Family")
--   ledger_members         a person in a group
--   ledger_member_rates    contribution amount history per member. A change applies from its
--                          effective date only, so obligations already generated keep their amount.
--   ledger_member_spans    when a member is active. Pausing or leaving closes the span; paused
--                          periods never receive obligations.
--   ledger_expenses        shared expenses (the user paid, people owe a share)
--   ledger_obligations     one row per amount owed: a recurring period, a share of a shared
--                          expense, or a manual due. Unique per (member, period).
--   ledger_payments        payments against one obligation. Voided, never deleted.
--
-- Outstanding = sum(obligations.amount) - sum(non-voided payments.amount).
--
-- Write model
--   people / groups / members / rates / spans   written by the user directly under RLS.
--   expenses / obligations / payments           read-only for users. Every write goes through a
--                                               SECURITY DEFINER function that validates ownership
--                                               and amounts and writes related rows atomically.
--
-- No existing object is altered.

/* ------------------------------------------------------------------ preflight */

do $preflight$
declare
  v_problems text[] := array[]::text[];
begin
  if to_regprocedure('auth.uid()') is null then
    v_problems := v_problems || 'auth.uid() is missing'::text;
  end if;
  if to_regclass('public.ledger_people') is not null
     or to_regclass('public.ledger_obligations') is not null
     or to_regclass('public.ledger_payments') is not null then
    v_problems := v_problems || 'ledger tables already exist (an earlier attempt was applied?)'::text;
  end if;
  if array_length(v_problems, 1) > 0 then
    raise exception 'Personal Ledger preflight failed: %', array_to_string(v_problems, '; ');
  end if;
end;
$preflight$;

/* ------------------------------------------------------------------ people */

create table public.ledger_people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  phone text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_people_id_user_key unique (id, user_id),
  constraint ledger_people_name_check check (char_length(btrim(name)) between 1 and 80),
  constraint ledger_people_phone_check check (phone is null or char_length(btrim(phone)) between 1 and 30),
  constraint ledger_people_notes_check check (notes is null or char_length(btrim(notes)) <= 300)
);

-- One active person per name, so people are reused instead of duplicated.
create unique index ledger_people_active_name_key
  on public.ledger_people (user_id, lower(btrim(name))) where archived_at is null;

/* ------------------------------------------------------------------ groups */

create table public.ledger_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  description text,
  frequency text not null default 'monthly',
  frequency_interval integer not null default 1,
  start_date date not null,
  -- Optional due date: each obligation is due this many days after its period starts.
  due_offset_days smallint not null default 0,
  is_active boolean not null default true,
  currency text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_groups_id_user_key unique (id, user_id),
  constraint ledger_groups_name_check check (char_length(btrim(name)) between 1 and 80),
  constraint ledger_groups_description_check check (description is null or char_length(btrim(description)) <= 200),
  constraint ledger_groups_frequency_check check (frequency in ('weekly', 'monthly', 'yearly', 'custom_days', 'custom_months')),
  constraint ledger_groups_interval_check check (
    (frequency not in ('custom_days', 'custom_months') and frequency_interval = 1)
    or (frequency = 'custom_days' and frequency_interval between 1 and 3650)
    or (frequency = 'custom_months' and frequency_interval between 1 and 120)
  ),
  constraint ledger_groups_start_check check (start_date >= date '2000-01-01'),
  constraint ledger_groups_due_offset_check check (due_offset_days between 0 and 365),
  constraint ledger_groups_currency_check check (currency ~ '^[A-Z]{3}$')
);

/* ------------------------------------------------------------------ members, rates, spans */

create table public.ledger_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_id uuid not null,
  person_id uuid not null,
  joined_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_members_id_user_key unique (id, user_id),
  constraint ledger_members_group_person_key unique (group_id, person_id),
  constraint ledger_members_group_fkey foreign key (group_id, user_id)
    references public.ledger_groups (id, user_id) on delete cascade,
  constraint ledger_members_person_fkey foreign key (person_id, user_id)
    references public.ledger_people (id, user_id) on delete restrict,
  constraint ledger_members_joined_check check (joined_on >= date '2000-01-01')
);

create table public.ledger_member_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  member_id uuid not null,
  effective_from date not null,
  amount numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_member_rates_member_fkey foreign key (member_id, user_id)
    references public.ledger_members (id, user_id) on delete cascade,
  constraint ledger_member_rates_date_key unique (member_id, effective_from),
  constraint ledger_member_rates_amount_check check (amount > 0 and amount <= 999999999999.99),
  constraint ledger_member_rates_date_check check (effective_from >= date '2000-01-01')
);

create table public.ledger_member_spans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  member_id uuid not null,
  from_date date not null,
  to_date date,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_member_spans_member_fkey foreign key (member_id, user_id)
    references public.ledger_members (id, user_id) on delete cascade,
  constraint ledger_member_spans_range_check check (from_date >= date '2000-01-01' and (to_date is null or to_date > from_date)),
  constraint ledger_member_spans_reason_check check (
    (to_date is null and end_reason is null)
    or (to_date is not null and end_reason in ('paused', 'left'))
  )
);

-- A member has at most one open (current) span.
create unique index ledger_member_spans_open_key on public.ledger_member_spans (member_id) where to_date is null;

/* ------------------------------------------------------------------ expenses */

create table public.ledger_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  description text,
  total_amount numeric(14, 2) not null,
  expense_date date not null,
  -- A free-text label. Deliberately not the categories table: the ledger stays isolated.
  category text,
  allow_unallocated boolean not null default false,
  currency text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_expenses_id_user_key unique (id, user_id),
  constraint ledger_expenses_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint ledger_expenses_description_check check (description is null or char_length(btrim(description)) <= 300),
  constraint ledger_expenses_amount_check check (total_amount > 0 and total_amount <= 999999999999.99),
  constraint ledger_expenses_date_check check (expense_date >= date '2000-01-01'),
  constraint ledger_expenses_category_check check (category is null or char_length(btrim(category)) between 1 and 40),
  constraint ledger_expenses_currency_check check (currency ~ '^[A-Z]{3}$')
);

/* ------------------------------------------------------------------ obligations */

create table public.ledger_obligations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id uuid not null,
  source text not null,
  group_id uuid,
  member_id uuid,
  period_start date,
  expense_id uuid,
  title text not null,
  amount numeric(14, 2) not null,
  due_date date not null,
  currency text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_obligations_id_user_key unique (id, user_id),
  constraint ledger_obligations_person_fkey foreign key (person_id, user_id)
    references public.ledger_people (id, user_id) on delete restrict,
  constraint ledger_obligations_member_fkey foreign key (member_id, user_id)
    references public.ledger_members (id, user_id) on delete restrict,
  constraint ledger_obligations_expense_fkey foreign key (expense_id, user_id)
    references public.ledger_expenses (id, user_id) on delete restrict,
  constraint ledger_obligations_source_check check (source in ('recurring', 'shared', 'manual')),
  constraint ledger_obligations_shape_check check (
    (source = 'recurring' and member_id is not null and group_id is not null and period_start is not null and expense_id is null)
    or (source = 'shared' and expense_id is not null and member_id is null and group_id is null and period_start is null)
    or (source = 'manual' and expense_id is null and member_id is null and group_id is null and period_start is null)
  ),
  constraint ledger_obligations_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint ledger_obligations_amount_check check (amount > 0 and amount <= 999999999999.99),
  constraint ledger_obligations_due_check check (due_date >= date '2000-01-01'),
  constraint ledger_obligations_note_check check (note is null or char_length(btrim(note)) <= 300),
  constraint ledger_obligations_currency_check check (currency ~ '^[A-Z]{3}$')
);

-- Each billing period of a member exists once. This is what prevents duplicate recurring dues,
-- however many devices generate them.
create unique index ledger_obligations_period_key
  on public.ledger_obligations (member_id, period_start) where source = 'recurring';
-- A person appears once per shared expense.
create unique index ledger_obligations_share_key
  on public.ledger_obligations (expense_id, person_id) where source = 'shared';
create index ledger_obligations_user_person_idx on public.ledger_obligations (user_id, person_id);
create index ledger_obligations_group_idx on public.ledger_obligations (group_id) where group_id is not null;
create index ledger_obligations_expense_idx on public.ledger_obligations (expense_id) where expense_id is not null;

/* ------------------------------------------------------------------ payments */

create table public.ledger_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  obligation_id uuid not null,
  amount numeric(14, 2) not null,
  paid_on date not null,
  note text,
  -- A mistaken payment is voided, never deleted, so history stays complete.
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_payments_obligation_fkey foreign key (obligation_id, user_id)
    references public.ledger_obligations (id, user_id) on delete restrict,
  constraint ledger_payments_amount_check check (amount > 0 and amount <= 999999999999.99),
  constraint ledger_payments_date_check check (paid_on >= date '2000-01-01'),
  constraint ledger_payments_note_check check (note is null or char_length(btrim(note)) <= 300)
);

create index ledger_payments_obligation_idx on public.ledger_payments (obligation_id);
create index ledger_payments_user_date_idx on public.ledger_payments (user_id, paid_on desc);

/* ------------------------------------------------------------------ guards */

-- A group's schedule and currency can't change once it has produced obligations: the periods
-- they belong to are derived from the schedule, and their amounts are in the group's currency.
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

create trigger ledger_group_guard
before update on public.ledger_groups
for each row
execute function public.ledger_group_guard();

-- An obligation can never be lowered below what has been paid on it.
create or replace function public.ledger_obligation_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_paid numeric;
begin
  select coalesce(sum(p.amount), 0) into v_paid
  from public.ledger_payments p
  where p.obligation_id = new.id and p.voided_at is null;
  if new.amount < v_paid then
    raise exception 'This amount is less than the % already paid.', v_paid using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

create trigger ledger_obligation_guard
before update of amount on public.ledger_obligations
for each row
execute function public.ledger_obligation_guard();

-- A payment can never exceed what is still owed. The obligation row is locked first, so two
-- concurrent payments are checked one after the other.
create or replace function public.ledger_payment_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_obligation numeric;
  v_paid numeric;
begin
  select o.amount into v_obligation
  from public.ledger_obligations o
  where o.id = new.obligation_id and o.user_id = new.user_id
  for update;
  if not found then
    raise exception 'This due no longer exists.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.obligation_id <> old.obligation_id then
    raise exception 'A payment can''t move to another due.' using errcode = 'P0001';
  end if;
  if new.voided_at is null then
    select coalesce(sum(p.amount), 0) into v_paid
    from public.ledger_payments p
    where p.obligation_id = new.obligation_id and p.voided_at is null and p.id <> new.id;
    if v_paid + new.amount > v_obligation then
      raise exception 'This payment is more than the remaining balance (%).', v_obligation - v_paid using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$function$;

create trigger ledger_payment_guard
before insert or update on public.ledger_payments
for each row
execute function public.ledger_payment_guard();

/* ------------------------------------------------------------------ RLS */

alter table public.ledger_people enable row level security;
alter table public.ledger_groups enable row level security;
alter table public.ledger_members enable row level security;
alter table public.ledger_member_rates enable row level security;
alter table public.ledger_member_spans enable row level security;
alter table public.ledger_expenses enable row level security;
alter table public.ledger_obligations enable row level security;
alter table public.ledger_payments enable row level security;

create policy "Users can view own ledger people" on public.ledger_people for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own ledger people" on public.ledger_people for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own ledger people" on public.ledger_people for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own ledger people" on public.ledger_people for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can view own ledger groups" on public.ledger_groups for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own ledger groups" on public.ledger_groups for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own ledger groups" on public.ledger_groups for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own ledger groups" on public.ledger_groups for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can view own ledger members" on public.ledger_members for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own ledger members" on public.ledger_members for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own ledger members" on public.ledger_members for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own ledger members" on public.ledger_members for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can view own ledger member rates" on public.ledger_member_rates for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own ledger member rates" on public.ledger_member_rates for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own ledger member rates" on public.ledger_member_rates for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own ledger member rates" on public.ledger_member_rates for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can view own ledger member spans" on public.ledger_member_spans for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own ledger member spans" on public.ledger_member_spans for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own ledger member spans" on public.ledger_member_spans for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own ledger member spans" on public.ledger_member_spans for delete to authenticated using ((select auth.uid()) = user_id);

-- Expenses, obligations and payments are read-only for users: no write policy and no privilege.
create policy "Users can view own ledger expenses" on public.ledger_expenses for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can view own ledger obligations" on public.ledger_obligations for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can view own ledger payments" on public.ledger_payments for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table
  public.ledger_people, public.ledger_groups, public.ledger_members, public.ledger_member_rates,
  public.ledger_member_spans, public.ledger_expenses, public.ledger_obligations, public.ledger_payments
from anon, authenticated;
grant select, insert, update, delete on table
  public.ledger_people, public.ledger_groups, public.ledger_members, public.ledger_member_rates,
  public.ledger_member_spans
to authenticated;
grant select on table public.ledger_expenses, public.ledger_obligations, public.ledger_payments to authenticated;

/* ------------------------------------------------------------------ write functions */

-- Saves a manual or recurring obligation. Recurring obligations are generated by the app for each
-- billing period; the unique (member, period) index guarantees a period exists once.
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

-- Saves a shared expense and its per-person shares (obligations) in one transaction.
-- p_shares: [{"id": uuid, "person_id": uuid, "amount": number}, ...]
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

-- Deletes an expense together with its shares, only while none of them has a payment.
create or replace function public.ledger_delete_expense(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_old public.ledger_expenses%rowtype;
begin
  if v_user is null then
    raise exception 'Sign in again to change this expense.' using errcode = '42501';
  end if;
  select * into v_old from public.ledger_expenses where id = p_id for update;
  if not found then
    return;
  end if;
  if v_old.user_id <> v_user then
    raise exception 'You don''t have permission to change this expense.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.ledger_payments p
    join public.ledger_obligations o on o.id = p.obligation_id
    where o.expense_id = p_id
  ) then
    raise exception 'This expense has payments, so it is kept for the history.' using errcode = 'P0001';
  end if;
  delete from public.ledger_obligations where expense_id = p_id and user_id = v_user;
  delete from public.ledger_expenses where id = p_id and user_id = v_user;
end;
$function$;

-- Records, edits or voids a payment. The payment guard trigger enforces the remaining balance.
create or replace function public.ledger_save_payment(
  p_id uuid,
  p_obligation_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_note text,
  p_voided boolean,
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
  v_old public.ledger_payments%rowtype;
  v_has boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_user is null then
    raise exception 'Sign in again to save this payment.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 999999999999.99 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter a valid amount (up to two decimal places).' using errcode = 'P0001';
  end if;
  if p_paid_on is null or p_paid_on < date '2000-01-01' then
    raise exception 'Choose a valid payment date.' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'Keep notes under 300 characters.' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.ledger_obligations o where o.id = p_obligation_id and o.user_id = v_user) then
    raise exception 'This due no longer exists.' using errcode = 'P0001';
  end if;

  select * into v_old from public.ledger_payments where id = p_id for update;
  v_has := found;
  if v_has and v_old.user_id <> v_user then
    raise exception 'You don''t have permission to change this payment.' using errcode = '42501';
  end if;
  if v_has and v_old.obligation_id <> p_obligation_id then
    raise exception 'A payment can''t move to another due.' using errcode = 'P0001';
  end if;

  if v_has then
    update public.ledger_payments
    set amount = p_amount, paid_on = p_paid_on, note = v_note,
        voided_at = case when coalesce(p_voided, false) then coalesce(v_old.voided_at, v_edited) else null end,
        updated_at = v_edited
    where id = p_id and user_id = v_user;
  else
    insert into public.ledger_payments (
      id, user_id, obligation_id, amount, paid_on, note, voided_at, created_at, updated_at
    ) values (
      p_id, v_user, p_obligation_id, p_amount, p_paid_on, v_note,
      case when coalesce(p_voided, false) then v_edited else null end,
      least(coalesce(p_created_at, v_edited), v_now), v_edited
    );
  end if;
end;
$function$;

revoke all on function public.ledger_group_guard() from public, anon, authenticated;
revoke all on function public.ledger_obligation_guard() from public, anon, authenticated;
revoke all on function public.ledger_payment_guard() from public, anon, authenticated;
revoke all on function public.ledger_save_obligation(uuid, uuid, text, uuid, uuid, date, text, numeric, date, text, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.ledger_delete_obligation(uuid) from public, anon;
revoke all on function public.ledger_save_expense(uuid, text, text, numeric, date, text, boolean, text, jsonb, timestamptz, timestamptz) from public, anon;
revoke all on function public.ledger_delete_expense(uuid) from public, anon;
revoke all on function public.ledger_save_payment(uuid, uuid, numeric, date, text, boolean, timestamptz, timestamptz) from public, anon;
grant execute on function public.ledger_save_obligation(uuid, uuid, text, uuid, uuid, date, text, numeric, date, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.ledger_delete_obligation(uuid) to authenticated;
grant execute on function public.ledger_save_expense(uuid, text, text, numeric, date, text, boolean, text, jsonb, timestamptz, timestamptz) to authenticated;
grant execute on function public.ledger_delete_expense(uuid) to authenticated;
grant execute on function public.ledger_save_payment(uuid, uuid, numeric, date, text, boolean, timestamptz, timestamptz) to authenticated;

commit;
