// Short-lived consent session for the OAuth interaction pages.
//
// This is deliberately NOT the app's Supabase session. The consent step needs
// one thing only — "which MindCanvas user proved their password inside this
// interaction" — and it needs it for the couple of minutes between the login
// form and the Authorize button. Reusing the app session here would mean any
// tab already signed in could be silently walked through a connector approval.
//
// Cookie value is `<userId>.<hmac>` where hmac = HMAC-SHA256(secret, userId).
// The signature is what makes it unforgeable; the cookie carries no other
// state, so nothing here needs decrypting.
//
// LIMITATION worth knowing: because the payload is just the user id, the value
// is a bearer credential for consent that is valid as long as the browser
// holds it. Max-Age below (not the signature) is what bounds it — keep it
// short, and always clear it once consent is recorded.

import crypto from "node:crypto";

export const OAUTH_SESSION_COOKIE = "oauth_session";

// Scoped to the interaction subtree so it is never sent to the app, the API,
// or the MCP endpoint.
const COOKIE_PATH = "/oauth/interact";

// Matches AUTH_REQUEST_TTL_MS in shared.js — the pending authorization request
// expires at the same time, so a longer-lived cookie would buy nothing.
const COOKIE_MAX_AGE_SECONDS = 10 * 60;

function sessionSecret() {
  // No new required env var: OAUTH_SESSION_SECRET is honoured if set, then
  // NEXTAUTH_SECRET, then the service-role key — which is already a
  // server-only secret this deployment cannot function without.
  const secret =
    process.env.OAUTH_SESSION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "No signing secret available for the OAuth consent session.",
    );
  }
  return secret;
}

export function signUserId(userId) {
  return crypto
    .createHmac("sha256", sessionSecret())
    .update(userId)
    .digest("hex");
}

export function buildSessionValue(userId) {
  return `${userId}.${signUserId(userId)}`;
}

/**
 * Verify a cookie value and return the user id it attests to, or null.
 *
 * The comparison is constant-time: a byte-by-byte early exit would let an
 * attacker discover a valid signature one character at a time.
 */
export function readSessionValue(value) {
  if (typeof value !== "string") return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;

  const userId = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!userId || !signature) return null;

  let expected;
  try {
    expected = signUserId(userId);
  } catch {
    return null;
  }

  const given = Buffer.from(signature, "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length) return null;
  if (!crypto.timingSafeEqual(given, want)) return null;

  return userId;
}

function cookieAttributes(request) {
  // Secure is derived, not hardcoded: a hardcoded Secure flag means the cookie
  // is silently dropped on http://localhost and the flow cannot be tested.
  const isHttps = new URL(request.url).protocol === "https:";
  return [
    `Path=${COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    isHttps ? "Secure" : null,
  ].filter(Boolean);
}

export function sessionCookieHeader(request, userId) {
  return [
    `${OAUTH_SESSION_COOKIE}=${buildSessionValue(userId)}`,
    ...cookieAttributes(request),
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ].join("; ");
}

export function clearSessionCookieHeader(request) {
  return [
    `${OAUTH_SESSION_COOKIE}=`,
    ...cookieAttributes(request),
    "Max-Age=0",
  ].join("; ");
}

/** 303 redirect that also writes a Set-Cookie header. */
export function redirectWithCookie(location, cookie) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}
