// GET /api/oauth/auth — authorization endpoint (RFC 6749 §4.1.1 + PKCE).
//
// Validates the client's authorization request, parks it in oauth_codes as a
// PENDING row keyed "interact_<uid>", and hands the browser to the consent
// page at /oauth/interact/<uid>. Nothing is granted here: the pending row has
// user_id NULL until a real MindCanvas user approves it.
//
// Error handling follows RFC 6749 §4.1.2.1: if client_id or redirect_uri is
// bad we must NOT redirect (the redirect target is exactly what we failed to
// verify, so bouncing the error there would make this an open redirector).
// Everything else redirects back to the verified redirect_uri with ?error=,
// which is what the client is waiting for.

import crypto from "node:crypto";
import {
  AUTH_REQUEST_TTL_MS,
  CODES_TABLE,
  PENDING_CODE_PREFIX,
  findClient,
  jsonError,
  redirectUriRegistered,
  serviceClient,
  serviceUnavailable,
} from "@/lib/oauth/shared";

export const dynamic = "force-dynamic";

function redirectWithError(redirectUri, state, error, description) {
  const target = new URL(redirectUri);
  target.searchParams.set("error", error);
  target.searchParams.set("error_description", description);
  if (state) target.searchParams.set("state", state);
  return Response.redirect(target.toString(), 302);
}

export async function GET(request) {
  const supabase = serviceClient();
  if (!supabase) return serviceUnavailable();

  const { searchParams } = new URL(request.url);
  const responseType = searchParams.get("response_type");
  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod = searchParams.get("code_challenge_method");
  const state = searchParams.get("state") || "";
  const scope = searchParams.get("scope") || "mcp";

  // --- Errors that must NOT redirect ------------------------------------
  if (!clientId) {
    return jsonError(400, "invalid_request", "client_id is required.");
  }
  if (!redirectUri) {
    return jsonError(400, "invalid_request", "redirect_uri is required.");
  }

  const client = await findClient(supabase, clientId);
  if (!client) {
    return jsonError(
      400,
      "invalid_client",
      "Unknown client_id. Register the client at /api/oauth/register first.",
    );
  }

  if (!redirectUriRegistered(client, redirectUri)) {
    return jsonError(
      400,
      "invalid_request",
      "redirect_uri does not exactly match a URI registered for this client.",
    );
  }

  // --- Errors that DO redirect back to the (now verified) client ---------
  if (responseType !== "code") {
    return redirectWithError(
      redirectUri,
      state,
      "unsupported_response_type",
      "Only response_type=code is supported.",
    );
  }
  if (!codeChallenge) {
    return redirectWithError(
      redirectUri,
      state,
      "invalid_request",
      "code_challenge is required — PKCE is mandatory on this server.",
    );
  }
  if (codeChallengeMethod !== "S256") {
    return redirectWithError(
      redirectUri,
      state,
      "invalid_request",
      "code_challenge_method must be S256.",
    );
  }

  // --- Park the request for the consent step ----------------------------
  const uid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + AUTH_REQUEST_TTL_MS).toISOString();

  const { error } = await supabase.from(CODES_TABLE).insert({
    code: `${PENDING_CODE_PREFIX}${uid}`,
    client_id: clientId,
    user_id: null, // nobody has consented yet
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scope,
    state,
    expires_at: expiresAt,
  });

  if (error) {
    console.error("[oauth] pending authorization insert failed:", error.message);
    return redirectWithError(
      redirectUri,
      state,
      "server_error",
      "Could not start the authorization request.",
    );
  }

  // The consent page reads its display data from the query string; the pending
  // row above remains the authoritative copy, so a tampered query cannot widen
  // the request that eventually gets approved.
  const consentUrl = new URL(`/oauth/interact/${uid}`, request.url);
  consentUrl.searchParams.set("client_id", clientId);
  consentUrl.searchParams.set("redirect_uri", redirectUri);
  consentUrl.searchParams.set("code_challenge", codeChallenge);
  consentUrl.searchParams.set("code_challenge_method", codeChallengeMethod);
  consentUrl.searchParams.set("scope", scope);
  if (state) consentUrl.searchParams.set("state", state);

  return Response.redirect(consentUrl.toString(), 302);
}
