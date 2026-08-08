// POST /api/oauth/register — Dynamic Client Registration (RFC 7591).
//
// Claude.ai has no pre-shared credentials with this deployment, so it registers
// itself here and gets back a client_id/client_secret it uses for the rest of
// the flow.
//
// Registration is unauthenticated, which RFC 7591 permits for an open
// registration endpoint. That is safe here only because registering grants
// nothing on its own: a client can obtain a token only by driving a real
// MindCanvas user through the consent screen, and every issued token is scoped
// to that user's own data.

import crypto from "node:crypto";
import {
  CLIENTS_TABLE,
  jsonError,
  jsonOk,
  serviceClient,
  serviceUnavailable,
} from "@/lib/oauth/shared";

export const dynamic = "force-dynamic";

// Exact-match redirect validation at /api/oauth/auth is what actually protects
// codes, so registration only has to reject values that could never be a valid
// callback at all.
function isUsableRedirectUri(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  // A fragment is forbidden on a redirect_uri (RFC 6749 §3.1.2) — the
  // authorization response appends its own query, and a fragment would make
  // the resulting URL unparseable by the client.
  if (parsed.hash) return false;
  return true;
}

export async function POST(request) {
  const supabase = serviceClient();
  if (!supabase) return serviceUnavailable();

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(
      400,
      "invalid_client_metadata",
      "Request body must be JSON.",
    );
  }

  const redirectUris = body?.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return jsonError(
      400,
      "invalid_client_metadata",
      "redirect_uris is required and must be a non-empty array.",
    );
  }

  const invalid = redirectUris.filter((uri) => !isUsableRedirectUri(uri));
  if (invalid.length > 0) {
    return jsonError(
      400,
      "invalid_client_metadata",
      `redirect_uris contains entries that are not absolute, fragment-free URIs: ${invalid.join(", ")}`,
    );
  }

  const clientName =
    typeof body?.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim()
      : "Unnamed client";

  const clientId = `mc_client_${crypto.randomUUID()}`;
  const clientSecret = crypto.randomBytes(32).toString("hex");

  // Everything goes into `payload`: oidc_clients has only
  // (id, payload, consumed_at, expires_at) — there is no redirect_uris column.
  // expires_at stays NULL so a registered client survives cold starts; the
  // whole reason this table exists separately from oidc_models is that
  // oidc_models sweeps rows on a 24h default expiry.
  const payload = {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: redirectUris,
    client_name: clientName,
    token_endpoint_auth_method: "client_secret_post",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };

  const { error } = await supabase
    .from(CLIENTS_TABLE)
    .insert({ id: clientId, payload, expires_at: null });

  if (error) {
    // Surfaced, not swallowed. A silently-failed insert here is invisible to
    // the client until the next step fails with "unknown client_id", which is
    // how a missing table previously read as a mysterious 400 at /auth.
    console.error("[oauth] client registration insert failed:", error.message);
    return jsonError(
      400,
      "invalid_client_metadata",
      `Could not persist the client registration: ${error.message}`,
    );
  }

  return jsonOk(
    {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: redirectUris,
      client_name: clientName,
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_id_issued_at: payload.client_id_issued_at,
      client_secret_expires_at: 0, // 0 = never expires (RFC 7591 §3.2.1)
    },
    201,
  );
}
