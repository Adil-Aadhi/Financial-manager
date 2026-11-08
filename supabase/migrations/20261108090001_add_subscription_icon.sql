begin;

-- Add a user-selectable icon without changing existing subscription behaviour.
alter table public.subscriptions
  add column if not exists icon text;

-- Existing subscriptions use the same fallback as newly created subscriptions.
update public.subscriptions
set icon = 'repeat-2'
where icon is null;

alter table public.subscriptions
  alter column icon set default 'repeat-2',
  alter column icon set not null;

-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS, so guard it explicitly.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriptions_icon_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_icon_check
      check (icon ~ '^[a-z0-9-]{1,40}$');
  end if;
end
$$;

commit;
