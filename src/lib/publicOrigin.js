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

// Where the OAuth route handlers live. This is a ROUTE prefix only — it is
// deliberately NOT part of the issuer any more.
//
// It used to be. oidc-provider derived its "mount path" from the issuer's
// pathname, so the path had to be there for the URLs it generated to land on a
// real handler. oidc-provider is gone; the handlers are now plain Next.js
// routes at fixed paths, and an issuer with a path only creates work — RFC 8414
// §3.1 would then require the metadata at a path-inserted well-known location,
// giving two documents that can drift apart.
export const OAUTH_MOUNT_PATH = "/api/oauth";

// The issuer IS the bare origin. Keeping this helper (rather than inlining
// resolvePublicOrigin at every call site) means the identifier has one
// definition, so discovery, the protected-resource documents and the MCP
// route cannot disagree about it.
export function resolveOAuthIssuer(request) {
  return resolvePublicOrigin(request);
}

export function oauthIssuerFromOrigin(origin) {
  return normalizeOrigin(origin) ?? origin;
}
