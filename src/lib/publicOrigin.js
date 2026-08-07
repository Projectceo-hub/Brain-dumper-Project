// Single source of truth for the origin this deployment advertises.
//
// Every OAuth/MCP discovery document, the WWW-Authenticate challenge, and the
// oidc-provider issuer must all name the SAME origin. When they disagree, the
// client validates the `resource` field against the URL it was given, sees a
// mismatch, and aborts the flow before it ever reaches the token endpoint —
// which surfaces in Claude's UI as a connector that simply refuses to connect.
//
// NEXT_PUBLIC_APP_URL wins when set, so a deployment behind a proxy or a
// custom domain advertises the URL users actually type rather than whatever
// internal host the request happened to arrive on. When it is unset we derive
// the origin from the incoming request, which keeps localhost and preview
// deployments working with no configuration.
export function normalizeOrigin(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

export function resolvePublicOrigin(request) {
  const configured = normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (configured) return configured;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

// The OAuth routes live under this path, and — critically — the oidc-provider
// issuer includes it too. oidc-provider derives its "mount path" from the
// issuer's pathname and prepends it to every URL it GENERATES (the resume
// returnTo, the authorization-response redirect, the discovery endpoints). With
// a bare-origin issuer it emitted root URLs like /auth/<uid> that have no
// Next.js handler; with the path here it emits /api/oauth/auth/<uid>, which the
// catch-all route serves. Route MATCHING is unaffected — oidc-provider's router
// still matches the un-prefixed path (/auth, /reg, …), so the catch-all must
// keep stripping this prefix before handing the request to the provider.
export const OAUTH_MOUNT_PATH = "/api/oauth";

// NEXT_PUBLIC_APP_URL must be a bare origin (no path). resolvePublicOrigin
// normalizes it to an origin, so appending the mount path here never
// double-counts /api/oauth even if the env var were mis-set with a trailing
// path — normalizeOrigin drops everything but the origin.
export function resolveOAuthIssuer(request) {
  return `${resolvePublicOrigin(request)}${OAUTH_MOUNT_PATH}`;
}

export function oauthIssuerFromOrigin(origin) {
  return `${normalizeOrigin(origin) ?? origin}${OAUTH_MOUNT_PATH}`;
}
