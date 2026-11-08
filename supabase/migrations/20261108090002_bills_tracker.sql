begin;

-- Independent bill reminders and confirmations. No account, transaction, budget,
-- daily-budget, or subscription table is referenced by this feature.
create table public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  category text not null,
  icon text not null default 'receipt-text',
  amount_type text not null,
  expected_amount numeric(14, 2),
  currency text not null,
  billing_cycle text not null,
  billing_interval integer not null default 1,
  billing_anchor_day smallint not null,
  start_date date not null,
  next_due_date date not null,
  reminder_days smallint not null default 0,
  lifecycle text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bills_id_user_key unique (id, user_id),
  constraint bills_name_check check (char_length(btrim(name)) between 1 and 80),
  constraint bills_category_check check (category in ('internet', 'mobile', 'electricity', 'water', 'rent', 'insurance', 'lic', 'education', 'loan', 'other')),
  constraint bills_icon_check check (icon ~ '^[a-z0-9-]{1,40}$'),
  constraint bills_amount_type_check check (amount_type in ('fixed', 'variable')),
  constraint bills_expected_amount_check check (
    (amount_type = 'fixed' and expected_amount is not null and expected_amount > 0 and expected_amount <= 999999999999.99)
    or (amount_type = 'variable' and (expected_amount is null or (expected_amount > 0 and expected_amount <= 999999999999.99)))
  ),
  constraint bills_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint bills_cycle_check check (billing_cycle in ('weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly', 'custom_days', 'custom_months')),
  constraint bills_interval_check check (
    (billing_cycle not in ('custom_days', 'custom_months') and billing_interval = 1)
    or (billing_cycle = 'custom_days' and billing_interval between 1 and 3650)
    or (billing_cycle = 'custom_months' and billing_interval between 1 and 120)
  ),
  constraint bills_anchor_check check (billing_anchor_day between 1 and 31),
  constraint bills_dates_check check (start_date >= date '2000-01-01' and next_due_date >= start_date),
  constraint bills_reminder_check check (reminder_days between 0 and 365),
  constraint bills_lifecycle_check check (lifecycle in ('active', 'paused', 'cancelled')),
  constraint bills_notes_check check (notes is null or char_length(btrim(notes)) <= 500)
);

create table public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bill_id uuid not null,
  due_date date not null,
  expected_amount numeric(14, 2),
  actual_amount numeric(14, 2) not null,
  payment_date date not null,
  paid_at timestamptz not null default now(),
  status text not null default 'paid',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bill_payments_bill_owner_fkey
    foreign key (bill_id, user_id)
    references public.bills (id, user_id)
    on delete cascade,
  constraint bill_payments_cycle_key unique (bill_id, due_date),
  constraint bill_payments_expected_check check (expected_amount is null or (expected_amount > 0 and expected_amount <= 999999999999.99)),
  constraint bill_payments_actual_check check (actual_amount > 0 and actual_amount <= 999999999999.99),
  constraint bill_payments_dates_check check (due_date >= date '2000-01-01' and payment_date >= date '2000-01-01'),
  constraint bill_payments_status_check check (status = 'paid')
);

create index bills_user_due_idx on public.bills (user_id, lifecycle, next_due_date);
create index bills_user_category_idx on public.bills (user_id, category);
create index bill_payments_user_date_idx on public.bill_payments (user_id, payment_date desc);
create index bill_payments_bill_due_idx on public.bill_payments (bill_id, due_date desc);

alter table public.bills enable row level security;
alter table public.bill_payments enable row level security;

create policy "Users can view own bills" on public.bills for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own bills" on public.bills for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own bills" on public.bills for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own bills" on public.bills for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can view own bill payments" on public.bill_payments for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own bill payments" on public.bill_payments for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.bills b where b.id = bill_id and b.user_id = (select auth.uid()))
);
create policy "Users can update own bill payments" on public.bill_payments for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.bills b where b.id = bill_id and b.user_id = (select auth.uid()))
);
create policy "Users can delete own bill payments" on public.bill_payments for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.bills, public.bill_payments from anon;
grant select, insert, update, delete on table public.bills, public.bill_payments to authenticated;

commit;
