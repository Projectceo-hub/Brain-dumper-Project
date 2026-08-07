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
