begin;

-- The project already has public.categories and transactions.category_id.
-- Strengthen the existing category model without changing transaction entry.
update public.categories
set is_default = false
where is_default is null;

alter table public.categories
  alter column name set not null,
  alter column type set not null,
  alter column icon set not null,
  alter column is_default set default false,
  alter column is_default set not null;

do $constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.categories'::regclass
      and conname = 'categories_type_check'
  ) then
    alter table public.categories
      add constraint categories_type_check
      check (type in ('income', 'expense')) not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.categories'::regclass
      and conname = 'categories_name_check'
  ) then
    alter table public.categories
      add constraint categories_name_check
      check (char_length(btrim(name)) between 1 and 50) not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.categories'::regclass
      and conname = 'categories_owner_check'
  ) then
    alter table public.categories
      add constraint categories_owner_check
      check (
        (is_default and user_id is null)
        or (not is_default and user_id is not null)
      ) not valid;
  end if;
end;
$constraints$;

alter table public.categories
  validate constraint categories_type_check,
  validate constraint categories_name_check,
  validate constraint categories_owner_check;

-- Names are case-insensitively unique within a type. System defaults are
-- shared rows; custom names are scoped to their owner.
create unique index if not exists categories_default_name_type_unique
on public.categories (type, lower(btrim(name)))
where is_default;

create unique index if not exists categories_user_name_type_unique
on public.categories (user_id, type, lower(btrim(name)))
where not is_default;

-- Keep existing transaction references safe. A used category cannot be
-- deleted; the application reports a friendly message and this FK is the
-- final database-level guard.
do $category_fk$
declare
  category_fk_name name;
  category_fk_delete_action text;
begin
  select c.conname, c.confdeltype::text
  into category_fk_name, category_fk_delete_action
  from pg_catalog.pg_constraint c
  where c.contype = 'f'
    and c.conrelid = 'public.transactions'::regclass
    and c.confrelid = 'public.categories'::regclass
    and c.conkey = array[
      (
        select a.attnum
        from pg_catalog.pg_attribute a
        where a.attrelid = 'public.transactions'::regclass
          and a.attname = 'category_id'
          and not a.attisdropped
      )
    ]::smallint[];

  if category_fk_name is null then
    alter table public.transactions
      add constraint transactions_category_id_fkey
      foreign key (category_id)
      references public.categories (id)
      on delete restrict;
  elsif category_fk_delete_action <> 'r' then
    execute pg_catalog.format(
      'alter table public.transactions drop constraint %I',
      category_fk_name
    );

    execute pg_catalog.format(
      'alter table public.transactions add constraint %I '
      'foreign key (category_id) references public.categories (id) '
      'on delete restrict',
      category_fk_name
    );
  end if;
end;
$category_fk$;

-- Replace category-only policies with an explicit ownership model. Default
-- rows are readable by every signed-in user; only owned custom rows are
-- writable.
alter table public.categories enable row level security;

do $policies$
declare
  category_policy record;
begin
  for category_policy in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'categories'
  loop
    execute pg_catalog.format(
      'drop policy if exists %I on public.categories',
      category_policy.policyname
    );
  end loop;
end;
$policies$;

create policy "Users can view available categories"
on public.categories
for select
to authenticated
using (is_default or user_id = (select auth.uid()));

create policy "Users can create own custom categories"
on public.categories
for insert
to authenticated
with check (
  not is_default
  and user_id = (select auth.uid())
);

create policy "Users can update own custom categories"
on public.categories
for update
to authenticated
using (
  not is_default
  and user_id = (select auth.uid())
)
with check (
  not is_default
  and user_id = (select auth.uid())
);

create policy "Users can delete own custom categories"
on public.categories
for delete
to authenticated
using (
  not is_default
  and user_id = (select auth.uid())
);

revoke all privileges on table public.categories from anon;
grant select, insert, update, delete on table public.categories to authenticated;

-- Shared defaults are inserted once and remain visible to every authenticated
-- user. The partial unique index makes this seed idempotent.
insert into public.categories (name, type, icon, user_id, is_default)
values
  ('Salary', 'income', 'briefcase', null, true),
  ('Freelance', 'income', 'laptop', null, true),
  ('Business', 'income', 'building-2', null, true),
  ('Investment', 'income', 'trending-up', null, true),
  ('Gift', 'income', 'gift', null, true),
  ('Other Income', 'income', 'circle-dollar-sign', null, true),
  ('Food & Dining', 'expense', 'utensils', null, true),
  ('Transportation', 'expense', 'car', null, true),
  ('Shopping', 'expense', 'shopping-bag', null, true),
  ('Bills & Utilities', 'expense', 'receipt', null, true),
  ('Rent & Housing', 'expense', 'house', null, true),
  ('Healthcare', 'expense', 'heart-pulse', null, true),
  ('Education', 'expense', 'graduation-cap', null, true),
  ('Entertainment', 'expense', 'film', null, true),
  ('Travel', 'expense', 'plane', null, true),
  ('Personal Care', 'expense', 'sparkles', null, true),
  ('Other Expense', 'expense', 'circle-ellipsis', null, true)
on conflict do nothing;

commit;
