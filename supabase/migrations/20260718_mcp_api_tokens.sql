-- Phase 4: MCP Server — personal API tokens
-- Each MindCanvas user can generate one or more API tokens that external MCP
-- clients (Claude Desktop, Cursor, etc.) present in the Authorization: Bearer
-- header to authenticate against /api/mcp. Tokens are stored as SHA-256
-- hashes; the raw token is shown exactly once at generation time.
--
-- All data access performed by the MCP server is scoped to the user_id that
-- owns the presented token — the same boundary Supabase RLS already enforces
-- for the regular web app, respected here at the application layer.

create table if not exists public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  label        text not null default 'default',
  token_hash   text not null,
  token_prefix text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create unique index if not exists api_tokens_token_hash_unique
  on public.api_tokens (token_hash)
  where revoked_at is null;

create index if not exists api_tokens_user_id_idx
  on public.api_tokens (user_id);

alter table public.api_tokens enable row level security;

drop policy if exists "Users can read own api tokens" on public.api_tokens;
create policy "Users can read own api tokens"
  on public.api_tokens for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own api tokens" on public.api_tokens;
create policy "Users can insert own api tokens"
  on public.api_tokens for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own api tokens" on public.api_tokens;
create policy "Users can update own api tokens"
  on public.api_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own api tokens" on public.api_tokens;
create policy "Users can delete own api tokens"
  on public.api_tokens for delete
  using (auth.uid() = user_id);
