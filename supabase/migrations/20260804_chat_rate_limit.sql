-- Phase 10: chat_usage table.
--
-- One row per (user, day) counting calls to /api/chat. The route reads the
-- row for CURRENT_DATE, refuses the request at 30, and otherwise upserts
-- call_count + 1 before talking to the model.
--
-- Unlike note_links, this table keys on auth.users(id) directly (uuid), not
-- on the TEXT ids Dexie generates — it never joins to notes or folders.
--
-- RLS: a user may only ever see or touch their own counter row. There is no
-- delete policy on purpose, so a user cannot reset their own daily quota.
--
-- This migration is idempotent: re-running it is safe.

create table if not exists public.chat_usage (
  user_id    uuid references auth.users(id) on delete cascade,
  date       date not null default current_date,
  call_count integer not null default 0,
  primary key (user_id, date)
);

alter table public.chat_usage enable row level security;

drop policy if exists "Users can read own usage" on public.chat_usage;
drop policy if exists "Users can update own usage" on public.chat_usage;
drop policy if exists "Users can insert own usage" on public.chat_usage;

create policy "Users can read own usage"
  on public.chat_usage
  for select
  using (auth.uid() = user_id);

create policy "Users can update own usage"
  on public.chat_usage
  for update
  using (auth.uid() = user_id);

create policy "Users can insert own usage"
  on public.chat_usage
  for insert
  with check (auth.uid() = user_id);
