begin;

-- Independent subscription reminders. These tables have no foreign keys or triggers touching
-- accounts, transactions, categories, monthly budgets, or daily budgets.
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  amount numeric(14, 2) not null,
  currency text not null,
  billing_cycle text not null,
  billing_anchor_day smallint not null,
  start_date date not null,
  next_payment_date date not null,
  lifecycle text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_id_user_key unique (id, user_id),
  constraint subscriptions_name_check check (char_length(btrim(name)) between 1 and 80),
  constraint subscriptions_amount_check check (amount > 0 and amount <= 999999999999.99),
  constraint subscriptions_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint subscriptions_cycle_check check (billing_cycle in ('weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly')),
  constraint subscriptions_anchor_check check (billing_anchor_day between 1 and 31),
  constraint subscriptions_dates_check check (start_date >= date '2000-01-01' and next_payment_date >= date '2000-01-01'),
  constraint subscriptions_lifecycle_check check (lifecycle in ('active', 'paused', 'cancelled')),
  constraint subscriptions_notes_check check (notes is null or char_length(btrim(notes)) <= 500)
);

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subscription_id uuid not null,
  due_date date not null,
  paid_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_payments_subscription_owner_fkey
    foreign key (subscription_id, user_id)
    references public.subscriptions (id, user_id)
    on delete cascade,
  constraint subscription_payments_cycle_key unique (subscription_id, due_date),
  constraint subscription_payments_due_date_check check (due_date >= date '2000-01-01')
);

create index subscriptions_user_next_idx on public.subscriptions (user_id, lifecycle, next_payment_date);
create index subscription_payments_user_idx on public.subscription_payments (user_id);
create index subscription_payments_subscription_due_idx on public.subscription_payments (subscription_id, due_date desc);

alter table public.subscriptions enable row level security;
alter table public.subscription_payments enable row level security;

create policy "Users can view own subscriptions" on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own subscriptions" on public.subscriptions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own subscriptions" on public.subscriptions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own subscriptions" on public.subscriptions for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can view own subscription payments" on public.subscription_payments for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own subscription payments" on public.subscription_payments for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.subscriptions s
    where s.id = subscription_id and s.user_id = (select auth.uid())
  )
);
create policy "Users can update own subscription payments" on public.subscription_payments for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.subscriptions s
    where s.id = subscription_id and s.user_id = (select auth.uid())
  )
);
create policy "Users can delete own subscription payments" on public.subscription_payments for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.subscriptions, public.subscription_payments from anon;
grant select, insert, update, delete on table public.subscriptions, public.subscription_payments to authenticated;

commit;
