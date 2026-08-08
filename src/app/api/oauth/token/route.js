// POST /api/oauth/token — token endpoint (RFC 6749 §4.1.3 + PKCE §4.6).
//
// Exchanges a one-time authorization code plus the PKCE code_verifier for an
// access token. The access token is written to api_tokens — the SAME table
// personal tokens live in — so /api/mcp keeps exactly one bearer lookup
// (sha256 -> user_id) rather than two stores that can disagree about whether a
// token is valid. Only the SHA-256 hash is stored; the raw token leaves this
// handler once and is never recoverable from the database.

import {
  CODES_TABLE,
  PENDING_CODE_PREFIX,
  TOKENS_TABLE,
  findClient,
  jsonError,
  jsonOk,
  pkceS256,
  randomToken,
  serviceClient,
  serviceUnavailable,
  sha256Hex,
} from "@/lib/oauth/shared";

export const dynamic = "force-dynamic";

// Constant-time compare so a mismatched verifier or secret cannot be recovered
// by timing the response.
function safeEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i += 1) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

export async function POST(request) {
  const supabase = serviceClient();
  if (!supabase) return serviceUnavailable();

  let form;
  try {
    form = await request.formData();
  } catch {
    return jsonError(
      400,
      "invalid_request",
      "Body must be application/x-www-form-urlencoded.",
    );
  }

  const field = (name) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };

  const grantType = field("grant_type");
  const code = field("code");
  const redirectUri = field("redirect_uri");
  const clientId = field("client_id");
  const codeVerifier = field("code_verifier");
  const clientSecret = field("client_secret");

  if (grantType !== "authorization_code") {
    return jsonError(
      400,
      "unsupported_grant_type",
      "Only grant_type=authorization_code is supported.",
    );
  }
  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return jsonError(
      400,
      "invalid_request",
      "code, redirect_uri, client_id and code_verifier are all required.",
    );
  }

  // A pending row is not a code. Without this check a client that scraped the
  // uid out of the consent URL could redeem a request nobody ever approved.
  if (code.startsWith(PENDING_CODE_PREFIX)) {
    return jsonError(400, "invalid_grant", "That code is not redeemable.");
  }

  const client = await findClient(supabase, clientId);
  if (!client) {
    return jsonError(400, "invalid_client", "Unknown client_id.");
  }

  // Registration hands out client_secret_post credentials, but PKCE is what
  // actually binds the code to the caller. Validate the secret when one is
  // presented; allow its absence so a public client (auth method "none", also
  // advertised in discovery) can still complete the exchange.
  if (clientSecret && !safeEquals(clientSecret, client.client_secret || "")) {
    return jsonError(401, "invalid_client", "client_secret does not match.");
  }

  const { data: row, error: lookupError } = await supabase
    .from(CODES_TABLE)
    .select(
      "code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at",
    )
    .eq("code", code)
    .maybeSingle();

  if (lookupError) {
    console.error("[oauth] code lookup failed:", lookupError.message);
    return jsonError(400, "invalid_grant", "Could not verify the code.");
  }
  if (!row) {
    return jsonError(
      400,
      "invalid_grant",
      "Authorization code is unknown or has already been used.",
    );
  }

  // Delete first, then validate. The code is single-use, and deleting up front
  // means a replay racing the original request cannot both succeed — whichever
  // caller loses the race finds no row at all.
  const { error: deleteError } = await supabase
    .from(CODES_TABLE)
    .delete()
    .eq("code", code);
  if (deleteError) {
    console.error("[oauth] code delete failed:", deleteError.message);
    return jsonError(400, "invalid_grant", "Could not consume the code.");
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return jsonError(400, "invalid_grant", "Authorization code has expired.");
  }
  if (row.client_id !== clientId) {
    return jsonError(400, "invalid_grant", "Code was issued to another client.");
  }
  if (row.redirect_uri !== redirectUri) {
    return jsonError(
      400,
      "invalid_grant",
      "redirect_uri does not match the one used to obtain the code.",
    );
  }
  if (!row.user_id) {
    return jsonError(
      400,
      "invalid_grant",
      "That authorization was never approved by a user.",
    );
  }
  if (row.code_challenge_method !== "S256") {
    return jsonError(400, "invalid_grant", "Unsupported code_challenge_method.");
  }
  if (!safeEquals(pkceS256(codeVerifier), row.code_challenge)) {
    return jsonError(400, "invalid_grant", "PKCE verification failed.");
  }

  const accessToken = randomToken("mc_at_");
  const clientName =
    typeof client.client_name === "string" && client.client_name
      ? client.client_name
      : clientId;

  const { error: insertError } = await supabase.from(TOKENS_TABLE).insert({
    user_id: row.user_id,
    label: clientName,
    token_hash: sha256Hex(accessToken),
    token_prefix: accessToken.slice(0, 8),
    client_id: clientId,
    expires_at: null, // no expiry yet — revocation is via the tokens page
  });

  if (insertError) {
    console.error("[oauth] access token insert failed:", insertError.message);
    return jsonError(400, "invalid_grant", "Could not issue an access token.");
  }

  return jsonOk({
    access_token: accessToken,
    token_type: "bearer",
    scope: row.scope || "mcp",
  });
}
