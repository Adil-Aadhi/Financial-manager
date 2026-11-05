begin;

-- Keep the existing date column unchanged. Older transactions remain valid
-- with a null time and display an em dash in the application.
alter table public.transactions
add column if not exists transaction_time time without time zone null;

-- Supports newest-first account history without changing existing rows.
create index if not exists transactions_account_history_idx
on public.transactions (
  account_id,
  transaction_date desc,
  transaction_time desc nulls last,
  created_at desc
);

commit;
