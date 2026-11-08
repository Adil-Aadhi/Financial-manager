begin;

-- Installments Tracker: independent EMI / Buy Now Pay Later / custom plans with their own
-- schedule and payment history.
--
-- The only links to existing financial data are on installment_payments:
--   * account_id      the account a "Linked Account" payment was paid from;
--   * transaction_id  the single expense transaction that records that payment, either created
--                     by this feature (transaction_origin = 'created') or an existing transaction
--                     the user linked (transaction_origin = 'linked').
-- Account balances are never written: they stay opening balance + transactions.
-- Cash and Other / Manual payments can never reference an account or a transaction.
--
-- Write model:
--   * installment_plans      written by the user directly, under RLS, checks and a guard trigger.
--   * installment_payments   read-only for users. Every write goes through
--                            save_installment_payment() / delete_installment_payment(), which
--                            validate ownership, schedule coverage, amounts and the linked
--                            expense, and write the payment and its expense in one transaction.
--
-- No existing column, constraint, policy or function is altered. Outside the new objects this
-- migration adds exactly two things:
--   * triggers on public.transactions: protect_installment_transactions stops direct edits/deletes
--     of installment-generated expenses, and sync_linked_installment_payment_* keeps a manually
--     linked payment in step with its transaction. Transactions with no installment link are
--     unaffected;
--   * one shared default category, "Installment Payment", inserted idempotently.
--
-- A preflight block first verifies the existing schema, ownership and RLS assumptions and aborts
-- the whole migration if any of them doesn't hold.

/* ------------------------------------------------------------------ preflight */

-- public.accounts, public.transactions and public.categories were created outside these
-- migrations, so their exact shape, ownership and RLS settings can't be read from the repo. This
-- block checks every assumption the objects below rely on and aborts the whole migration (nothing
-- is created) with a clear message if one doesn't hold.
do $preflight$
declare
  v_problems text[] := array[]::text[];
  v_col record;
  v_role record;
  v_tx regclass := to_regclass('public.transactions');
  v_acc regclass := to_regclass('public.accounts');
  v_cat regclass := to_regclass('public.categories');
  v_bypasses boolean;
  v_missing text[];
begin
  if v_tx is null or v_acc is null or v_cat is null then
    raise exception 'Installments preflight: public.accounts, public.transactions and public.categories must exist.';
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'Installments preflight: auth.uid() is missing.';
  end if;

  -- Column types the functions and foreign keys depend on.
  for v_col in
    select x.tbl, x.col, x.allowed, t.typname, a.attnum
    from (values
      ('transactions', 'id', array['uuid']),
      ('transactions', 'user_id', array['uuid']),
      ('transactions', 'account_id', array['uuid']),
      ('transactions', 'category_id', array['uuid']),
      ('transactions', 'amount', array['numeric', 'float8', 'float4', 'int4', 'int8']),
      ('transactions', 'description', array['text', 'varchar']),
      -- Must be timestamptz: the India-calendar conversion below (and the existing report
      -- functions from 20261106084513) are only correct for instants.
      ('transactions', 'transaction_date', array['timestamptz']),
      ('transactions', 'transaction_time', array['time']),
      ('transactions', 'created_at', array['timestamptz']),
      ('transactions', 'updated_at', array['timestamptz']),
      ('accounts', 'id', array['uuid']),
      ('accounts', 'user_id', array['uuid']),
      ('accounts', 'deleted_at', array['timestamptz']),
      ('categories', 'id', array['uuid']),
      ('categories', 'name', array['text', 'varchar']),
      ('categories', 'type', array['text', 'varchar']),
      ('categories', 'is_default', array['bool'])
    ) as x(tbl, col, allowed)
    left join pg_catalog.pg_attribute a
      on a.attrelid = ('public.' || x.tbl)::regclass and a.attname = x.col and not a.attisdropped
    left join pg_catalog.pg_type t on t.oid = a.atttypid
  loop
    if v_col.attnum is null then
      v_problems := v_problems || format('%s.%s is missing', v_col.tbl, v_col.col);
    elsif not (v_col.typname = any (v_col.allowed)) then
      v_problems := v_problems || format('%s.%s is %s, expected %s', v_col.tbl, v_col.col, v_col.typname, array_to_string(v_col.allowed, ' or '));
    end if;
  end loop;

  -- transactions.type may be text or an enum; it must accept 'expense'.
  select t.typname, t.typtype into v_col
  from pg_catalog.pg_attribute a join pg_catalog.pg_type t on t.oid = a.atttypid
  where a.attrelid = v_tx and a.attname = 'type' and not a.attisdropped;
  if not found then
    v_problems := v_problems || 'transactions.type is missing'::text;
  elsif v_col.typtype = 'e' and not exists (
    select 1 from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
    where t.typname = v_col.typname and e.enumlabel = 'expense'
  ) then
    v_problems := v_problems || 'transactions.type enum has no ''expense'' value'::text;
  elsif v_col.typtype <> 'e' and v_col.typname not in ('text', 'varchar') then
    v_problems := v_problems || format('transactions.type is %s, expected text or an enum', v_col.typname);
  end if;

  -- The SECURITY DEFINER payment functions run as the role applying this migration. They insert,
  -- update and delete the user's generated expenses, so that role must bypass the transactions
  -- RLS policies (superuser, BYPASSRLS, or table owner without FORCE ROW LEVEL SECURITY) and hold
  -- the needed privileges. Supabase's postgres role normally satisfies all of this.
  select r.rolsuper, r.rolbypassrls into v_role from pg_catalog.pg_roles r where r.rolname = current_user;
  select v_role.rolsuper or v_role.rolbypassrls
      or (c.relowner = (select oid from pg_catalog.pg_roles where rolname = current_user) and not c.relforcerowsecurity)
  into v_bypasses
  from pg_catalog.pg_class c where c.oid = v_tx;
  if not v_bypasses then
    v_problems := v_problems || format('role %s can''t bypass RLS on public.transactions (apply this migration as postgres)', current_user);
  end if;
  -- has_table_privilege() with a list is true if ANY listed privilege is held, so check each one.
  select array_agg(format('%s on public.%s', x.priv, x.tbl) order by x.tbl, x.priv)
  into v_missing
  from (values
    ('transactions', 'SELECT'), ('transactions', 'INSERT'), ('transactions', 'UPDATE'), ('transactions', 'DELETE'),
    ('transactions', 'REFERENCES'), ('transactions', 'TRIGGER'),
    ('accounts', 'SELECT'), ('accounts', 'REFERENCES'),
    ('categories', 'SELECT'), ('categories', 'INSERT')
  ) as x(tbl, priv)
  where not has_table_privilege(current_user, ('public.' || x.tbl)::regclass, x.priv);
  if v_missing is not null then
    v_problems := v_problems || format('role %s lacks %s', current_user, array_to_string(v_missing, ', '));
  end if;

  -- Names this migration creates must be free (no partial earlier attempt).
  if to_regclass('public.installment_plans') is not null or to_regclass('public.installment_payments') is not null then
    v_problems := v_problems || 'installment tables already exist (an earlier attempt was applied?)'::text;
  end if;
  if exists (
    select 1 from pg_catalog.pg_trigger where tgrelid = v_tx and not tgisinternal
      and tgname in ('protect_installment_transactions', 'sync_linked_installment_payment_update', 'zz_sync_linked_installment_payment_delete')
  ) then
    v_problems := v_problems || 'installment triggers already exist on public.transactions'::text;
  end if;

  if array_length(v_problems, 1) > 0 then
    raise exception 'Installments preflight failed: %', array_to_string(v_problems, '; ');
  end if;
end;
$preflight$;

/* ------------------------------------------------------------------ plans */

create table public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  description text,
  plan_type text not null,
  provider text not null,
  product_category text not null,
  icon text not null default 'smartphone',
  original_amount numeric(14, 2) not null,
  down_payment numeric(14, 2) not null default 0,
  financed_amount numeric(14, 2) not null,
  interest_amount numeric(14, 2) not null default 0,
  additional_fees numeric(14, 2) not null default 0,
  total_repayment_amount numeric(14, 2) not null,
  currency text not null,
  installment_count integer not null,
  default_installment_amount numeric(14, 2) not null,
  billing_cycle text not null,
  billing_interval integer not null default 1,
  start_date date not null,
  first_due_date date not null,
  reminder_days smallint not null default 3,
  lifecycle text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installment_plans_id_user_key unique (id, user_id),
  constraint installment_plans_name_check check (char_length(btrim(name)) between 1 and 80),
  constraint installment_plans_description_check check (description is null or char_length(btrim(description)) <= 200),
  constraint installment_plans_type_check check (plan_type in ('product_emi', 'bnpl', 'custom')),
  constraint installment_plans_provider_check check (char_length(btrim(provider)) between 1 and 60),
  constraint installment_plans_category_check check (product_category in ('mobile', 'laptop', 'electronics', 'appliance', 'furniture', 'vehicle', 'fashion', 'travel', 'education', 'health', 'shopping', 'other')),
  constraint installment_plans_icon_check check (icon ~ '^[a-z0-9-]{1,40}$'),
  constraint installment_plans_amounts_check check (
    original_amount > 0 and original_amount <= 999999999999.99
    and down_payment >= 0 and down_payment < original_amount
    and interest_amount >= 0 and additional_fees >= 0
    and financed_amount = original_amount - down_payment
    and total_repayment_amount = financed_amount + interest_amount + additional_fees
    and total_repayment_amount <= 999999999999.99
  ),
  constraint installment_plans_count_check check (installment_count between 1 and 600),
  -- The final installment settles the remainder, so it must stay greater than zero.
  constraint installment_plans_installment_check check (
    default_installment_amount > 0
    and default_installment_amount * (installment_count - 1) < total_repayment_amount
  ),
  constraint installment_plans_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint installment_plans_cycle_check check (billing_cycle in ('weekly', 'monthly', 'quarterly', 'custom_days', 'custom_months')),
  constraint installment_plans_interval_check check (
    (billing_cycle not in ('custom_days', 'custom_months') and billing_interval = 1)
    or (billing_cycle = 'custom_days' and billing_interval between 1 and 3650)
    or (billing_cycle = 'custom_months' and billing_interval between 1 and 120)
  ),
  constraint installment_plans_dates_check check (start_date >= date '2000-01-01' and first_due_date >= start_date),
  constraint installment_plans_reminder_check check (reminder_days between 0 and 365),
  constraint installment_plans_lifecycle_check check (lifecycle in ('active', 'paused', 'completed', 'cancelled')),
  constraint installment_plans_notes_check check (notes is null or char_length(btrim(notes)) <= 500)
);

/* ------------------------------------------------------------------ payments */

create table public.installment_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  installment_plan_id uuid not null,
  installment_number integer not null,
  -- 'installment' settles exactly one installment; 'closure' (early closure) settles every
  -- remaining installment from installment_number through the plan's last installment.
  kind text not null default 'installment',
  covers_through integer not null,
  -- Computed by save_installment_payment() from the plan, never taken from the client.
  due_date date not null,
  expected_amount numeric(14, 2) not null,
  actual_amount numeric(14, 2) not null,
  payment_date date not null,
  payment_method text not null,
  -- set null (never cascade): purging a trashed account or deleting the transaction from the
  -- Transactions page must not erase installment history.
  account_id uuid references public.accounts (id) on delete set null,
  transaction_id uuid references public.transactions (id) on delete set null,
  transaction_origin text,
  notes text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installment_payments_plan_owner_fkey
    foreign key (installment_plan_id, user_id)
    references public.installment_plans (id, user_id)
    on delete cascade,
  constraint installment_payments_sequence_key unique (installment_plan_id, installment_number),
  -- One expense transaction can record at most one installment payment.
  constraint installment_payments_transaction_key unique (transaction_id),
  constraint installment_payments_number_check check (installment_number between 1 and 600),
  constraint installment_payments_kind_check check (
    (kind = 'installment' and covers_through = installment_number)
    or (kind = 'closure' and covers_through >= installment_number and covers_through <= 600)
  ),
  constraint installment_payments_amounts_check check (
    expected_amount > 0 and expected_amount <= 999999999999.99
    and actual_amount > 0 and actual_amount <= 999999999999.99
  ),
  constraint installment_payments_dates_check check (due_date >= date '2000-01-01' and payment_date >= date '2000-01-01'),
  constraint installment_payments_method_check check (payment_method in ('account', 'cash', 'manual')),
  -- Cash and Other / Manual can never reference an account or a transaction. An account payment
  -- may only lose its references through the set-null actions above (see the guard trigger).
  constraint installment_payments_method_refs_check check (
    (payment_method in ('cash', 'manual') and account_id is null and transaction_id is null and transaction_origin is null)
    or (payment_method = 'account' and transaction_origin in ('created', 'linked'))
  ),
  constraint installment_payments_notes_check check (notes is null or char_length(btrim(notes)) <= 300)
);

create index installment_plans_user_lifecycle_idx on public.installment_plans (user_id, lifecycle, first_due_date);
create index installment_payments_user_date_idx on public.installment_payments (user_id, payment_date desc);
create index installment_payments_plan_idx on public.installment_payments (installment_plan_id, installment_number);
create index installment_payments_account_idx on public.installment_payments (account_id) where account_id is not null;

/* ------------------------------------------------------------------ schedule helpers */

-- Due date of installment n. Months are always added to the first due date (never chained), and
-- Postgres clamps to the month's last day: 31 Jan -> 28/29 Feb -> 31 Mar. Same rule as the app.
create or replace function public.installment_due_date(
  p_first_due date, p_cycle text, p_interval integer, p_number integer
)
returns date
language sql
immutable
set search_path = ''
as $function$
  select case p_cycle
    when 'weekly' then p_first_due + 7 * (p_number - 1)
    when 'custom_days' then p_first_due + p_interval * (p_number - 1)
    when 'quarterly' then (p_first_due + pg_catalog.make_interval(months => 3 * (p_number - 1)))::date
    when 'custom_months' then (p_first_due + pg_catalog.make_interval(months => p_interval * (p_number - 1)))::date
    else (p_first_due + pg_catalog.make_interval(months => p_number - 1))::date
  end;
$function$;

-- Scheduled amount of installment n: the default amount, and the remainder on the last one.
create or replace function public.installment_expected_amount(
  p_total numeric, p_default numeric, p_count integer, p_number integer
)
returns numeric
language sql
immutable
set search_path = ''
as $function$
  select case when p_number < p_count then p_default else p_total - p_default * (p_count - 1) end;
$function$;

-- Number of installments a plan's payments settle. Coverage never overlaps (guard trigger and
-- save_installment_payment), so the sum of covered ranges is the number of settled installments.
create or replace function public.installment_covered_count(p_plan_id uuid)
returns integer
language sql
stable
set search_path = ''
as $function$
  select coalesce(sum(p.covers_through - p.installment_number + 1), 0)::integer
  from public.installment_payments p
  where p.installment_plan_id = p_plan_id;
$function$;

/* ------------------------------------------------------------------ payment guard */

-- Defence in depth for every write to installment_payments, whatever its path.
--
-- The single exemption is the exact shape of an ON DELETE SET NULL action: an UPDATE whose
-- only change is account_id and/or transaction_id becoming NULL. Clearing a reference can't
-- attach anything foreign, so ownership has nothing to check. Any other UPDATE, at any trigger
-- depth, is fully validated.
create or replace function public.installment_payment_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_plan record;
  v_tx record;
begin
  if tg_op = 'UPDATE'
     and (new.account_id is null or new.account_id = old.account_id)
     and (new.transaction_id is null or new.transaction_id = old.transaction_id)
     and (new.account_id is distinct from old.account_id or new.transaction_id is distinct from old.transaction_id)
     and (new.id, new.user_id, new.installment_plan_id, new.installment_number, new.kind, new.covers_through,
          new.due_date, new.expected_amount, new.actual_amount, new.payment_date, new.payment_method,
          new.transaction_origin, new.notes, new.paid_at, new.created_at, new.updated_at)
         is not distinct from
         (old.id, old.user_id, old.installment_plan_id, old.installment_number, old.kind, old.covers_through,
          old.due_date, old.expected_amount, old.actual_amount, old.payment_date, old.payment_method,
          old.transaction_origin, old.notes, old.paid_at, old.created_at, old.updated_at) then
    return new;
  end if;

  select p.user_id, p.installment_count into v_plan
  from public.installment_plans p
  where p.id = new.installment_plan_id;
  if not found or v_plan.user_id is distinct from new.user_id then
    raise exception 'Choose one of your installment plans.' using errcode = '42501';
  end if;

  -- Coverage: inside the plan, a closure runs to the last installment, and no overlap.
  if new.covers_through > v_plan.installment_count then
    raise exception 'That installment is not part of this plan.' using errcode = '23514';
  end if;
  if new.kind = 'closure' and new.covers_through <> v_plan.installment_count then
    raise exception 'An early closure must settle every remaining installment.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.installment_payments o
    where o.installment_plan_id = new.installment_plan_id
      and o.id <> new.id
      and o.installment_number <= new.covers_through
      and o.covers_through >= new.installment_number
  ) then
    raise exception 'These installments already have a payment.' using errcode = '23505';
  end if;

  if new.payment_method <> 'account' then
    return new;
  end if;

  if new.account_id is null or new.transaction_id is null then
    raise exception 'An account payment needs an account and its expense transaction.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.accounts a where a.id = new.account_id and a.user_id = new.user_id
  ) then
    raise exception 'Choose one of your accounts.' using errcode = '42501';
  end if;

  select t.user_id, t.account_id, t.type into v_tx
  from public.transactions t
  where t.id = new.transaction_id;
  if not found or v_tx.user_id is distinct from new.user_id then
    raise exception 'Choose one of your transactions.' using errcode = '42501';
  end if;
  if v_tx.type <> 'expense' then
    raise exception 'Only an expense transaction can record an installment payment.' using errcode = '23514';
  end if;
  if v_tx.account_id is distinct from new.account_id then
    raise exception 'The transaction must come from the selected account.' using errcode = '23514';
  end if;

  return new;
end;
$function$;

create trigger installment_payment_guard
before insert or update on public.installment_payments
for each row
execute function public.installment_payment_guard();

/* ------------------------------------------------------------------ plan guard */

-- Plans are written directly by their owner (RLS), so the rules that depend on payments live here:
--   * the installment count can't drop below a paid installment or move a closure's end;
--   * "completed" is only possible when every installment is settled, and an active plan whose
--     installments are all settled is completed.
create or replace function public.installment_plan_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_highest integer;
  v_closure_end integer;
  v_covered integer;
begin
  if tg_op = 'INSERT' then
    if new.lifecycle = 'completed' then
      raise exception 'A new plan has no settled installments yet.' using errcode = '23514';
    end if;
    return new;
  end if;

  select max(p.covers_through), max(p.covers_through) filter (where p.kind = 'closure')
  into v_highest, v_closure_end
  from public.installment_payments p
  where p.installment_plan_id = new.id;

  if v_closure_end is not null and v_closure_end <> new.installment_count then
    raise exception 'Undo the early closure before changing the number of installments.' using errcode = '23514';
  end if;
  if v_highest is not null and v_highest > new.installment_count then
    raise exception 'Installment % already has a payment, so the plan needs at least % installments.', v_highest, v_highest
      using errcode = '23514';
  end if;

  v_covered := public.installment_covered_count(new.id);
  if new.lifecycle = 'completed' and v_covered < new.installment_count then
    raise exception 'A plan is completed only when every installment is settled.' using errcode = '23514';
  end if;
  if new.lifecycle = 'active' and v_covered >= new.installment_count then
    new.lifecycle := 'completed';
  end if;
  return new;
end;
$function$;

create trigger installment_plan_guard
before insert or update on public.installment_plans
for each row
execute function public.installment_plan_guard();

/* ------------------------------------------------------------------ RLS */

alter table public.installment_plans enable row level security;
alter table public.installment_payments enable row level security;

create policy "Users can view own installment plans" on public.installment_plans
for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own installment plans" on public.installment_plans
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own installment plans" on public.installment_plans
for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own installment plans" on public.installment_plans
for delete to authenticated using ((select auth.uid()) = user_id);

-- Payments are read-only for users: no insert/update/delete policy and no write privilege.
create policy "Users can view own installment payments" on public.installment_payments
for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.installment_plans, public.installment_payments from anon, authenticated;
grant select, insert, update, delete on table public.installment_plans to authenticated;
grant select on table public.installment_payments to authenticated;

/* ------------------------------------------------------------------ payment writes */

-- Saves one installment payment and its expense transaction in a single database transaction.
--
-- SECURITY DEFINER so that it is the only writer of installment_payments. It therefore trusts
-- nothing from the caller: the user comes from auth.uid(), every row read is filtered by that
-- user, and the due date, expected amount, coverage, category and description are computed here.
--
-- p_transaction_origin:
--   null       Cash / Other / Manual. Any expense this payment created earlier is deleted
--              (restoring that balance); a linked transaction is only unlinked, never deleted.
--   'created'  the expense p_transaction_id is inserted, or updated in place when this payment
--              created it before (amount / account / date corrections).
--   'linked'   an existing expense of this user, from the selected account and for the same
--              amount, is referenced; nothing is inserted.
--
-- Idempotent: replaying the same call leaves exactly the same rows.
create or replace function public.save_installment_payment(
  p_id uuid,
  p_plan_id uuid,
  p_installment_number integer,
  p_kind text,
  p_actual_amount numeric,
  p_payment_date date,
  p_payment_method text,
  p_account_id uuid,
  p_transaction_id uuid,
  p_transaction_origin text,
  p_transaction_time time,
  p_notes text,
  p_paid_at timestamptz,
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
  v_plan public.installment_plans%rowtype;
  v_old public.installment_payments%rowtype;
  v_has_old boolean;
  v_covers integer;
  v_first_unpaid integer;
  v_expected numeric;
  v_due date;
  v_category uuid;
  v_description text;
  v_account record;
  v_tx record;
  v_drop uuid;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  -- Effective values. For a manually linked transaction they come from that transaction.
  v_actual numeric := p_actual_amount;
  v_date date := p_payment_date;
  v_link_account uuid := p_account_id;
  v_link record;
begin
  if v_user is null then
    raise exception 'Sign in again to save this payment.' using errcode = '42501';
  end if;

  select * into v_plan from public.installment_plans
  where id = p_plan_id and user_id = v_user
  for update;
  if not found then
    raise exception 'This installment plan no longer exists.' using errcode = 'P0001';
  end if;

  select * into v_old from public.installment_payments where id = p_id for update;
  v_has_old := found;
  if v_has_old and v_old.user_id <> v_user then
    raise exception 'You don''t have permission to change this payment.' using errcode = '42501';
  end if;
  if v_has_old and v_old.installment_plan_id <> p_plan_id then
    raise exception 'This payment belongs to a different plan.' using errcode = 'P0001';
  end if;
  if not v_has_old and v_plan.lifecycle = 'cancelled' then
    raise exception 'Reactivate this plan before recording a payment.' using errcode = 'P0001';
  end if;

  -- A manually linked transaction is the source of truth for its payment: while the link is
  -- unchanged, the amount, date and account always come from the transaction (it may have been
  -- edited in Transactions after this request was queued), so replay order can't leave them
  -- out of step.
  if v_has_old and v_old.transaction_origin = 'linked' and p_transaction_origin = 'linked'
     and v_old.transaction_id is not null and v_old.transaction_id = p_transaction_id then
    select t.amount, t.account_id, t.transaction_date, t.type into v_link
    from public.transactions t where t.id = p_transaction_id and t.user_id = v_user;
    if found and v_link.type = 'expense' then
      v_actual := v_link.amount;
      v_link_account := v_link.account_id;
      v_date := (v_link.transaction_date at time zone 'Asia/Kolkata')::date;
    end if;
  end if;

  -- Fields.
  if p_kind is null or p_kind not in ('installment', 'closure') then
    raise exception 'Choose a valid payment type.' using errcode = 'P0001';
  end if;
  if p_installment_number is null or p_installment_number < 1 or p_installment_number > v_plan.installment_count then
    raise exception 'That installment is not part of this plan.' using errcode = 'P0001';
  end if;
  if v_actual is null or v_actual <= 0 or v_actual > 999999999999.99
     or v_actual <> round(v_actual, 2) then
    raise exception 'Enter a valid amount paid (up to two decimal places).' using errcode = 'P0001';
  end if;
  if v_date is null or v_date < date '2000-01-01' then
    raise exception 'Choose a valid payment date.' using errcode = 'P0001';
  end if;
  if v_notes is not null and char_length(v_notes) > 300 then
    raise exception 'Keep notes under 300 characters.' using errcode = 'P0001';
  end if;

  -- Coverage. A closure always runs to the plan's last installment, must start at the first
  -- installment no other payment settles, and may not overlap any recorded payment.
  v_covers := case when p_kind = 'closure' then v_plan.installment_count else p_installment_number end;
  if exists (
    select 1 from public.installment_payments o
    where o.installment_plan_id = p_plan_id
      and o.id <> p_id
      and o.installment_number <= v_covers
      and o.covers_through >= p_installment_number
  ) then
    if p_kind = 'closure' then
      raise exception 'An installment in the closure range is already paid. Undo it or close from a later installment.' using errcode = 'P0001';
    end if;
    raise exception 'Installment % already has a payment or was settled by the early closure.', p_installment_number using errcode = 'P0001';
  end if;

  if p_kind = 'closure' then
    select min(g) into v_first_unpaid
    from pg_catalog.generate_series(1, v_plan.installment_count) as g
    where not exists (
      select 1 from public.installment_payments o
      where o.installment_plan_id = p_plan_id and o.id <> p_id
        and g between o.installment_number and o.covers_through
    );
    if v_first_unpaid is distinct from p_installment_number then
      raise exception 'An early closure must start at the first unpaid installment (%).', v_first_unpaid using errcode = 'P0001';
    end if;
    -- What is still payable: the scheduled total minus everything actually paid so far.
    select v_plan.total_repayment_amount - coalesce(sum(o.actual_amount), 0)
    into v_expected
    from public.installment_payments o
    where o.installment_plan_id = p_plan_id and o.id <> p_id;
    if v_expected <= 0 then
      raise exception 'Nothing remains to be paid on this plan.' using errcode = 'P0001';
    end if;
  else
    v_expected := public.installment_expected_amount(
      v_plan.total_repayment_amount, v_plan.default_installment_amount, v_plan.installment_count, p_installment_number
    );
  end if;
  v_due := public.installment_due_date(v_plan.first_due_date, v_plan.billing_cycle, v_plan.billing_interval, p_installment_number);

  -- Method and references.
  if p_payment_method is null or p_payment_method not in ('account', 'cash', 'manual') then
    raise exception 'Choose a payment method.' using errcode = 'P0001';
  end if;
  if p_payment_method = 'account' then
    if v_link_account is null or p_transaction_id is null or p_transaction_origin is null
       or p_transaction_origin not in ('created', 'linked') then
      raise exception 'Choose the account this installment was paid from.' using errcode = 'P0001';
    end if;
    select a.id, a.deleted_at into v_account
    from public.accounts a where a.id = v_link_account and a.user_id = v_user;
    if not found then
      raise exception 'Choose one of your accounts.' using errcode = '42501';
    end if;
    -- New money movement needs an active account (same rule as the transaction form).
    if v_account.deleted_at is not null
       and (p_transaction_origin = 'created' or not v_has_old or v_old.account_id is distinct from v_link_account) then
      raise exception 'Choose one of your active accounts.' using errcode = 'P0001';
    end if;
  elsif v_link_account is not null or p_transaction_id is not null or p_transaction_origin is not null then
    raise exception 'Cash and manual payments cannot use an account or a transaction.' using errcode = 'P0001';
  end if;

  -- The only transaction this payment may ever delete is one it created itself.
  if v_has_old and v_old.transaction_origin = 'created' and v_old.transaction_id is not null
     and (p_transaction_origin is distinct from 'created' or p_transaction_id is distinct from v_old.transaction_id) then
    v_drop := v_old.transaction_id;
  end if;

  if p_transaction_origin = 'created' then
    select c.id into v_category
    from public.categories c
    where c.is_default and c.type = 'expense' and lower(btrim(c.name)) = 'installment payment'
    order by c.id
    limit 1;
    if v_category is null then
      raise exception 'The Installment Payment category is missing.' using errcode = 'P0001';
    end if;
    v_description := btrim(v_plan.name) || ' – ' ||
      case when p_kind = 'closure'
        then 'Early closure ' || case when v_covers > p_installment_number
          then p_installment_number::text || '–' || v_covers::text else p_installment_number::text end
        else 'Installment ' || p_installment_number::text
      end || '/' || v_plan.installment_count::text;

    select t.id, t.user_id into v_tx from public.transactions t where t.id = p_transaction_id;
    if found then
      if v_tx.user_id is distinct from v_user then
        raise exception 'Choose one of your transactions.' using errcode = '42501';
      end if;
      -- An existing expense may only be rewritten by the payment that created it. A replay of the
      -- first save finds its own payment row above, so retries are never blocked.
      if not (v_has_old and v_old.transaction_origin = 'created' and v_old.transaction_id = p_transaction_id) then
        raise exception 'This transaction already belongs to another record.' using errcode = 'P0001';
      end if;
      update public.transactions
      set account_id = v_link_account,
          category_id = v_category,
          type = 'expense',
          amount = v_actual,
          description = v_description,
          transaction_date = (v_date::timestamp at time zone 'UTC'),
          transaction_time = p_transaction_time,
          updated_at = v_edited
      where id = p_transaction_id and user_id = v_user;
    else
      insert into public.transactions (
        id, user_id, account_id, category_id, type, amount, description,
        transaction_date, transaction_time, created_at, updated_at
      ) values (
        p_transaction_id, v_user, v_link_account, v_category, 'expense', v_actual, v_description,
        (v_date::timestamp at time zone 'UTC'), p_transaction_time, v_edited, v_edited
      );
    end if;
  elsif p_transaction_origin = 'linked' then
    if v_has_old and v_old.transaction_origin = 'created' and v_old.transaction_id = p_transaction_id then
      raise exception 'This expense was recorded by this payment; keep it as a new expense instead of linking it.' using errcode = 'P0001';
    end if;
    select t.user_id, t.account_id, t.type, t.amount, t.transaction_date into v_tx
    from public.transactions t where t.id = p_transaction_id and t.user_id = v_user;
    if not found then
      raise exception 'The linked transaction no longer exists.' using errcode = 'P0001';
    end if;
    if v_tx.type <> 'expense' then
      raise exception 'Only an expense transaction can be linked.' using errcode = 'P0001';
    end if;
    if v_tx.account_id is distinct from v_link_account then
      raise exception 'The linked transaction is from a different account.' using errcode = 'P0001';
    end if;
    if v_tx.amount::numeric <> v_actual then
      raise exception 'The linked transaction amount must match the amount paid.' using errcode = 'P0001';
    end if;
    -- The payment date of a linked payment is the transaction's date (India calendar).
    v_date := (v_tx.transaction_date at time zone 'Asia/Kolkata')::date;
    if exists (
      select 1 from public.installment_payments o where o.transaction_id = p_transaction_id and o.id <> p_id
    ) then
      raise exception 'That transaction already records another installment payment.' using errcode = 'P0001';
    end if;
  end if;

  if v_has_old then
    update public.installment_payments
    set installment_number = p_installment_number,
        kind = p_kind,
        covers_through = v_covers,
        due_date = v_due,
        expected_amount = v_expected,
        actual_amount = v_actual,
        payment_date = v_date,
        payment_method = p_payment_method,
        account_id = v_link_account,
        transaction_id = p_transaction_id,
        transaction_origin = p_transaction_origin,
        notes = v_notes,
        updated_at = v_edited
    where id = p_id and user_id = v_user;
  else
    insert into public.installment_payments (
      id, user_id, installment_plan_id, installment_number, kind, covers_through, due_date,
      expected_amount, actual_amount, payment_date, payment_method, account_id, transaction_id,
      transaction_origin, notes, paid_at, created_at, updated_at
    ) values (
      p_id, v_user, p_plan_id, p_installment_number, p_kind, v_covers, v_due,
      v_expected, v_actual, v_date, p_payment_method, v_link_account, p_transaction_id,
      p_transaction_origin, v_notes, least(coalesce(p_paid_at, v_edited), v_now), least(coalesce(p_paid_at, v_edited), v_now), v_edited
    );
  end if;

  -- Deleted only after the payment row stopped referencing it, and only if nothing else does.
  if v_drop is not null then
    delete from public.transactions t
    where t.id = v_drop and t.user_id = v_user
      and not exists (select 1 from public.installment_payments o where o.transaction_id = v_drop);
  end if;

  -- Completed exactly when every installment is settled; reopened when it no longer is.
  if v_plan.lifecycle = 'active' and public.installment_covered_count(p_plan_id) >= v_plan.installment_count then
    update public.installment_plans set lifecycle = 'completed', updated_at = v_edited where id = p_plan_id and user_id = v_user;
  elsif v_plan.lifecycle = 'completed' and public.installment_covered_count(p_plan_id) < v_plan.installment_count then
    update public.installment_plans set lifecycle = 'active', updated_at = v_edited where id = p_plan_id and user_id = v_user;
  end if;
end;
$function$;

-- Undo: removes the payment and, in the same database transaction, the expense it created
-- (restoring that account's balance). A linked transaction is kept and only unlinked.
create or replace function public.delete_installment_payment(p_id uuid, p_edited_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_edited timestamptz := least(coalesce(p_edited_at, pg_catalog.now()), pg_catalog.now());
  v_payment public.installment_payments%rowtype;
  v_plan public.installment_plans%rowtype;
begin
  if v_user is null then
    raise exception 'Sign in again to change this payment.' using errcode = '42501';
  end if;

  select * into v_payment from public.installment_payments where id = p_id;
  if not found then
    return; -- already removed: a retried undo is a no-op
  end if;
  if v_payment.user_id <> v_user then
    raise exception 'You don''t have permission to change this payment.' using errcode = '42501';
  end if;

  select * into v_plan from public.installment_plans
  where id = v_payment.installment_plan_id and user_id = v_user
  for update;

  delete from public.installment_payments where id = p_id and user_id = v_user;
  if v_payment.transaction_origin = 'created' and v_payment.transaction_id is not null then
    delete from public.transactions t
    where t.id = v_payment.transaction_id and t.user_id = v_user
      and not exists (select 1 from public.installment_payments o where o.transaction_id = v_payment.transaction_id);
  end if;

  if v_plan.id is not null and v_plan.lifecycle = 'completed'
     and public.installment_covered_count(v_plan.id) < v_plan.installment_count then
    update public.installment_plans set lifecycle = 'active', updated_at = v_edited
    where id = v_plan.id and user_id = v_user;
  end if;
end;
$function$;

revoke all on function public.installment_due_date(date, text, integer, integer) from public, anon, authenticated;
revoke all on function public.installment_expected_amount(numeric, numeric, integer, integer) from public, anon, authenticated;
revoke all on function public.installment_covered_count(uuid) from public, anon;
revoke all on function public.installment_payment_guard() from public, anon, authenticated;
revoke all on function public.installment_plan_guard() from public, anon, authenticated;
revoke all on function public.save_installment_payment(uuid, uuid, integer, text, numeric, date, text, uuid, uuid, text, time, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.delete_installment_payment(uuid, timestamptz) from public, anon;
-- installment_covered_count is read by the plan guard, which runs as the signed-in user.
grant execute on function public.installment_covered_count(uuid) to authenticated;
grant execute on function public.save_installment_payment(uuid, uuid, integer, text, numeric, date, text, uuid, uuid, text, time, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.delete_installment_payment(uuid, timestamptz) to authenticated;

/* ------------------------------------------------------------------ generated-expense protection */

-- An expense created by an installment payment (transaction_origin = 'created') is managed by
-- the Installments page: users can see it in Transactions but can't edit or delete it there,
-- because the payment row and the expense must always change together.
--
-- Narrow exemption: current_user is the owner of the installment payment functions (true only
-- inside those SECURITY DEFINER functions, or for the admin role that applied this migration) or
-- the owner of public.transactions (foreign-key cascades when an expired account is purged from
-- Trash run as that owner). It doesn't depend on who owns which table. A signed-in user
-- (role authenticated) can never take that identity, at any trigger depth.
--
-- Linked transactions (transaction_origin = 'linked') are the user's own entries and stay fully
-- editable; this trigger only reads, so it can't recurse.
create or replace function public.protect_installment_transactions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user in (
    -- Inside save_/delete_installment_payment (SECURITY DEFINER) current_user is their owner.
    select pg_catalog.pg_get_userbyid(p.proowner)
    from pg_catalog.pg_proc p
    where p.oid in ('public.save_installment_payment'::pg_catalog.regproc, 'public.delete_installment_payment'::pg_catalog.regproc)
    union
    -- Foreign-key cascades (an expired account purged from Trash) run as the transactions owner.
    select pg_catalog.pg_get_userbyid(c.relowner)
    from pg_catalog.pg_class c
    where c.oid = 'public.transactions'::pg_catalog.regclass
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if exists (
    select 1 from public.installment_payments p
    where p.transaction_id = old.id and p.transaction_origin = 'created'
  ) then
    raise exception 'This expense is managed by Installments. Edit or undo the payment from the Installments page.'
      using errcode = 'P0001';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create trigger protect_installment_transactions
before update or delete on public.transactions
for each row
execute function public.protect_installment_transactions();

revoke all on function public.protect_installment_transactions() from public, anon, authenticated;

/* ------------------------------------------------------------------ linked-transaction sync */

-- A manually linked transaction stays the user's own and editable in Transactions; its installment
-- payment follows it:
--   * amount, date or account edited  -> the payment's actual_amount, payment_date (India calendar)
--                                        and account_id are updated to match;
--   * deleted, or no longer an expense -> the payment keeps its history (method, amount, date,
--                                        notes) and only transaction_id and account_id are cleared.
-- The transaction itself is never modified here. Installment-generated ('created') expenses are not
-- touched: they can only change through the payment functions.
--
-- SECURITY DEFINER because users have no write privilege on installment_payments; it only ever
-- touches payments of the same user that reference this exact transaction. It writes
-- installment_payments only, and nothing on that table writes transactions, so it can't recurse.
-- The unlink is a references-only change (updated_at untouched), the one shape the payment guard
-- exempts; the mirror update is fully validated by the guard (ownership, account match, coverage).
create or replace function public.sync_linked_installment_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    update public.installment_payments p
    set transaction_id = null, account_id = null
    where p.transaction_id = old.id and p.transaction_origin = 'linked' and p.user_id = old.user_id;
    return old;
  end if;

  if new.type is distinct from 'expense' or new.user_id is distinct from old.user_id then
    update public.installment_payments p
    set transaction_id = null, account_id = null
    where p.transaction_id = old.id and p.transaction_origin = 'linked' and p.user_id = old.user_id;
    return new;
  end if;

  if new.amount is not distinct from old.amount
     and new.transaction_date is not distinct from old.transaction_date
     and new.account_id is not distinct from old.account_id then
    return new;
  end if;

  update public.installment_payments p
  set actual_amount = new.amount,
      payment_date = (new.transaction_date at time zone 'Asia/Kolkata')::date,
      account_id = new.account_id,
      updated_at = pg_catalog.now()
  where p.transaction_id = new.id and p.transaction_origin = 'linked' and p.user_id = new.user_id;
  return new;
end;
$function$;

-- BEFORE triggers fire in name order. The "zz_" prefix makes this one fire after any existing
-- BEFORE DELETE trigger (and after protect_installment_transactions), so it only unlinks a payment
-- when nothing earlier has cancelled or refused the delete.
create trigger zz_sync_linked_installment_payment_delete
before delete on public.transactions
for each row
execute function public.sync_linked_installment_payment();

create trigger sync_linked_installment_payment_update
after update of amount, transaction_date, account_id, type, user_id on public.transactions
for each row
execute function public.sync_linked_installment_payment();

revoke all on function public.sync_linked_installment_payment() from public, anon, authenticated;

/* ------------------------------------------------------------------ category */

-- One shared, read-only default expense category (same model as the existing defaults). The
-- partial unique index categories_default_name_type_unique makes this a no-op if it exists.
insert into public.categories (name, type, icon, user_id, is_default)
values ('Installment Payment', 'expense', 'calendar-clock', null, true)
on conflict do nothing;

commit;
