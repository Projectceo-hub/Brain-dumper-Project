// Shared helpers for the minimal OAuth 2.0 authorization server.
//
// Every OAuth route is service-role only. These endpoints are called by an
// external client (Claude.ai) that has no Supabase session and no cookies, so
// there is nothing to authenticate a user-scoped client with. The one place a
// user session IS consulted is the consent step, which lives outside these
// routes.

import crypto from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase/service";

export const CLIENTS_TABLE = "oidc_clients";
export const CODES_TABLE = "oauth_codes";
export const TOKENS_TABLE = "api_tokens";

// Pending authorization requests are keyed by this prefix so they can never be
// mistaken for an issued authorization code at the token endpoint.
export const PENDING_CODE_PREFIX = "interact_";

// 10 minutes. Long enough to log in and read the consent screen, short enough
// that an abandoned request is not a standing grant.
export const AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;

export function serviceClient() {
  return getServiceSupabase();
}

export function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** RFC 7636 S256: BASE64URL(SHA256(ASCII(code_verifier))). */
export function pkceS256(codeVerifier) {
  return crypto.createHash("sha256").update(codeVerifier).digest("base64url");
}

export function randomToken(prefix) {
  return `${prefix}${crypto.randomBytes(32).toString("hex")}`;
}

export function jsonError(status, error, description) {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function jsonOk(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

export function serviceUnavailable() {
  return jsonError(
    503,
    "server_error",
    "OAuth server is not configured: SUPABASE_SERVICE_ROLE_KEY is missing.",
  );
}

/**
 * Load a registered client. oidc_clients stores everything in an opaque
 * `payload` jsonb column (id/payload/consumed_at/expires_at are the ONLY
 * columns), so per-client fields such as redirect_uris live inside payload,
 * not as columns of their own.
 */
export async function findClient(supabase, clientId) {
  if (!clientId) return null;
  const { data, error } = await supabase
    .from(CLIENTS_TABLE)
    .select("id, payload")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !data?.payload) return null;
  return data.payload;
}

/**
 * Exact-match a redirect_uri against the ones the client registered.
 *
 * Exact string comparison is deliberate — RFC 6749 §3.1.2.3 and RFC 8252 §7.3
 * both require it. Prefix or host-only matching is the classic authorization
 * code interception hole: an attacker registers a path under a permitted host
 * and receives codes meant for the real client.
 */
export function redirectUriRegistered(clientPayload, redirectUri) {
  const registered = Array.isArray(clientPayload?.redirect_uris)
    ? clientPayload.redirect_uris
    : [];
  return registered.includes(redirectUri);
}
