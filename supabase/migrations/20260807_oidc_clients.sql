-- Persistent store for oidc-provider's Client model (dynamic client
-- registration). Previously clients were written to oidc_models, whose
-- expires_at is NOT NULL and defaults to now() + 24h — so a DCR client such as
-- Claude.ai's connector was either given a TTL and swept, or dropped outright
-- (oidc-provider upserts a Client with no expiresIn, which produced an invalid
-- expiry). Either way the client_id registered on one request was gone on the
-- next, and Claude looped on "client not found".
--
-- This table holds clients with expires_at NULL so they never expire.

create table if not exists public.oidc_clients (
  id           text primary key,   -- the client_id
  payload      jsonb not null,     -- oidc-provider's client metadata payload
  consumed_at  timestamptz,        -- set by the adapter's consume() (unused for clients)
  expires_at   timestamptz         -- always NULL: clients do not expire
);

alter table public.oidc_clients enable row level security;

-- No RLS policies — like oidc_models, this table is an internal server-side
-- construct read and written exclusively by the Next.js API route via the
-- service-role Supabase client. External requests never touch it directly.
