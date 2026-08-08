// RFC 8414 OAuth 2.0 Authorization Server Metadata.
//
// The issuer is the BARE ORIGIN. It used to carry an /api/oauth path, which
// only existed because oidc-provider derived its mount path from the issuer.
// With oidc-provider gone the path serves no purpose, and dropping it means
// RFC 8414 §3.1 path insertion is a no-op: the metadata for this issuer lives
// at exactly <origin>/.well-known/oauth-authorization-server and nowhere else.
// One issuer, one document, no path-inserted variant to drift out of sync.
//
// Only endpoints that actually exist are advertised. The previous document
// listed introspection, revocation and jwks_uri; nothing serves those, so a
// client that tried to use them got a 404 mid-flow.

import { resolvePublicOrigin } from "@/lib/publicOrigin";

export async function getDiscoveryMetadata(request) {
  const origin = resolvePublicOrigin(request);

  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/auth`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,

    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],

    scopes_supported: ["mcp"],
    response_modes_supported: ["query"],
    subject_types_supported: ["public"],
  };
}
