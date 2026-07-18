# MindCanvas — Phase 4b Build Prompt (OAuth 2.0 DCR for claude.ai Web Connector)

## Full context (assume zero prior memory — read all of this)

MindCanvas: brain-dump notes + knowledge graph app. Non-technical
"vibe coder" founder — explain plainly. Strict £10/month budget — flag any
new cost before adding it.

**Stack:** Next.js App Router, Supabase (Postgres + RLS, email/password
auth, real source of truth), Dexie (local cache). Deployed on Vercel,
auto-deploys from GitHub (`Projectceo-hub/Brain-dumper-Project`) on push to
`main`. Live at brain-dumper-project.vercel.app.

**Already built (Phase 4, working, do not break):** MindCanvas is already
an MCP server at `src/app/api/mcp/route.js`, using
`@modelcontextprotocol/sdk`, exposing tools (list_folders, list_notes,
search_notes, get_note, create_note, update_note, organize_dump) scoped by
user via personal API tokens. Tokens are generated at `/settings/tokens`,
stored as SHA-256 hashes in a Supabase `api_tokens` table (RLS-protected).
**This currently works correctly with Claude Desktop** via a Bearer token
pasted into `claude_desktop_config.json`. Do not remove or break this path
— Desktop must keep working exactly as it does now.

## The problem this phase solves

Claude.ai's web "Add custom connector" flow does NOT support pasting a
Bearer token directly (that method, `static_headers`, is beta-only and not
available in the standard UI). The only method supported "out of the box"
for web connectors is **OAuth 2.0 with Dynamic Client Registration (DCR)**.
Without this, the MCP server cannot be connected from claude.ai in a
browser — only from Claude Desktop's local config file.

## What to build — follow Anthropic's actual spec precisely, do not improvise on the security-critical parts

This is quoted directly from Anthropic's own current developer
documentation (claude.com/docs/connectors/building/authentication) —
treat these as hard requirements, not general OAuth suggestions:

### 1. A `/register` endpoint (Dynamic Client Registration)
- Per RFC 7591, accepts `application/json` (not form-urlencoded — that's
  for a different endpoint, see below)
- Claude will call this to register itself as an OAuth client dynamically
  on first connection

### 2. Proper `401` responses with `WWW-Authenticate` header
- When an unauthenticated request hits the MCP endpoint, return an actual
  HTTP `401` status (not a JSON error body with a 200 status)
- Include this exact header format:
  `WWW-Authenticate: Bearer resource_metadata="https://<your-domain>/.well-known/oauth-protected-resource"`
- Claude does NOT honor a `WWW-Authenticate` header on a `200` response —
  it must be a real `401`

### 3. A `/.well-known/oauth-protected-resource` metadata endpoint
- Serves a JSON document
- The `resource` field must match the MCP server's URL EXACTLY as entered
  by the user (including any path component) — get this precise, a
  mismatch breaks the whole flow
- The `authorization_servers` field must list the authorization server's
  issuer URL. If listing more than one, put the primary one first — Claude
  uses only the first entry, no fallback

### 4. An authorization server with its own discovery metadata
- Serve RFC 8414 authorization server metadata (or OpenID Connect
  Discovery 1.0) at its own `/.well-known/` path
- Must advertise `"code_challenge_methods_supported": ["S256"]` (PKCE is
  required, not optional — Claude includes a PKCE `code_challenge` with
  `code_challenge_method=S256` on every authorization request)

### 5. A `/token` endpoint
- **Must accept `Content-Type: application/x-www-form-urlencoded`** (per
  RFC 6749 section 4.1.3) for both the initial token exchange AND refresh
  requests — this is different from the `/register` endpoint's JSON body.
  If using a framework that defaults to JSON-only body parsing, explicitly
  add a form-urlencoded parser for this specific endpoint or it will fail
  with a 415 error.
- On refresh failure, return RFC 6749-compliant error codes specifically
  (`invalid_grant`), not a custom error code
- Since Claude registers as a public client via DCR, rotate refresh tokens
  on each use (required per OAuth 2.1 / the MCP authorization spec's
  token-theft protections) — if you rotate, return the new refresh token
  in the same response that invalidates the old one

### 6. Callback URL registration
- Register this exact redirect URI on your authorization server:
  `https://claude.ai/api/mcp/auth_callback`

### 7. Response time budget
- Claude waits up to 10 seconds for discovery/registration/token endpoint
  responses, and up to 30 seconds for refresh requests. Don't let any of
  these block behind slow downstream calls (e.g. don't make the token
  endpoint wait on a slow database round-trip if avoidable) — return
  promptly to avoid intermittent failures.

## Architecture note

You'll likely need to decide whether to hand-roll all of this OAuth
machinery yourself inside the Next.js app, or use an existing library/
package that implements OAuth 2.0 authorization-server behavior (DCR,
PKCE, token endpoints) so you're not reimplementing security-sensitive
protocol details from scratch. If a well-maintained package exists that
handles this correctly (check current options before assuming), strongly
prefer it over a fully custom implementation — this is exactly the kind of
code where subtle mistakes create real security holes, and using a tested
library reduces that risk significantly. Flag which approach you're taking
and why before writing extensive custom crypto/protocol code.

## What NOT to do

- Do NOT break or modify the existing Claude Desktop Bearer-token flow —
  it must continue working exactly as-is alongside this new OAuth path.
  These can coexist (e.g. `static_headers`-style Desktop config stays,
  OAuth DCR is the new path specifically for claude.ai web).
- Do NOT skip PKCE, token rotation, or any of the "required" items above
  to save time — these are genuine security requirements, not
  nice-to-haves, given real user data sits behind this auth boundary.
- Do NOT touch the existing MCP tools' logic (list_folders, create_note,
  etc.) — this phase is purely about the authorization layer in front of
  them.

## Verification before saying done

This cannot be verified by build/lint passing alone — OAuth flows have to
be tested end to end. Steps:
1. Confirm Claude Desktop still connects and works exactly as before
   (regression check).
2. Attempt to add MindCanvas as a custom connector on claude.ai (web),
   using the real deployed MCP URL. Walk through the actual consent flow.
3. If it fails, capture the exact error and which step it failed at
   (registration, authorization redirect, token exchange) rather than
   guessing — OAuth failures are usually precise about which step broke.

## Commit/push policy

Do not commit or push without explicit confirmation first, especially
given this touches authentication/security — the founder should review
before this goes live.

## When done

Report: which approach was taken (custom-built vs. library-assisted) and
why, exact manual test steps for the founder to verify both Desktop and
web connections work, and any part of the spec above that couldn't be
fully implemented or needs the founder's attention.
