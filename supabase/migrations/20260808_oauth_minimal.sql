-- Minimal OAuth 2.0 authorization server (no oidc-provider).
--
-- Two changes:
--
-- 1. oauth_codes — short-lived rows for the authorization endpoint. A row is
--    written twice in the lifetime of one connection:
--      a. GET /api/oauth/auth writes a PENDING row keyed "interact_<uid>",
--         holding the client's authorization request while the user logs in
--         and approves. user_id is NULL at this point — nobody has consented.
--      b. The consent step (POST /oauth/interact/<uid>/confirm) resolves the
--         Supabase user, stamps user_id, and rekeys the row to the real
--         authorization code that goes back to the client as ?code=.
--    POST /api/oauth/token then consumes the row and deletes it (single use).
--
--    code_challenge is stored, code_verifier is never stored or transmitted to
--    us until the token request — that is the whole point of PKCE.
--
-- 2. api_tokens gains client_id + expires_at. OAuth access tokens live in the
--    SAME table as personal API tokens so /api/mcp keeps ONE bearer lookup
--    (sha256 -> user_id) instead of two stores that can disagree. The two
--    columns are additive and nullable, so existing personal-token rows are
--    unaffected: client_id NULL means "issued from Settings, not a connector",
--    expires_at NULL means "does not expire".

create table if not exists public.oauth_codes (
  code                  text primary key,   -- "interact_<uid>" while pending, then the real code
  client_id             text not null,
  user_id               uuid references auth.users(id) on delete cascade,
  redirect_uri          text not null,
  code_challenge        text not null,
  code_challenge_method text not null default 'S256',
  scope                 text,
  state                 text,
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now()
);

create index if not exists oauth_codes_expires_at_idx
  on public.oauth_codes (expires_at);

alter table public.oauth_codes enable row level security;

-- No RLS policies. Like oidc_clients, this table is an internal server-side
-- construct written and read exclusively by the OAuth route handlers via the
-- service-role client. A browser session must never be able to read a pending
-- authorization request or an unconsumed code.

alter table public.api_tokens
  add column if not exists client_id text;

alter table public.api_tokens
  add column if not exists expires_at timestamptz;

create index if not exists api_tokens_client_id_idx
  on public.api_tokens (client_id);
