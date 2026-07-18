-- Phase 4b: OAuth 2.0 authorization server tables for oidc-provider.
-- Used by the custom Supabase adapter to persist oidc-provider's
-- models (Client, Session, Grant, AccessToken, AuthorizationCode,
-- RefreshToken, DeviceCode, BackchannelAuthenticationRequest)
-- across stateless Next.js API route invocations.
--
-- Schema mirrors oidc-provider's internal payload shapes. A jsonb
-- column holds opaque model payloads; expires_at enables periodic
-- cleanup (oidc-provider marks consumed codes but doesn't delete them).

create table if not exists public.oidc_models (
  id          text primary key,                     -- model:id (e.g. "Client:123", "Session:abc")
  model_type  text not null,                        -- Client, Session, AccessToken, etc.
  payload     jsonb not null,                       -- oidc-provider's internal payload
  consumed    timestamptz,                          -- epoch timestamp set by consume()
  expires_at  timestamptz not null default now() + interval '24 hours',
  created_at  timestamptz not null default now()
);

create index if not exists oidc_models_expires_on_idx
  on public.oidc_models (expires_at);

alter table public.oidc_models enable row level security;

-- No RLS policies — oidc_models is an internal server-side construct
-- populated and read exclusively by the Next.js API route (service-role
-- Supabase client). External requests never touch this table directly.