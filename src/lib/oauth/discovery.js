// oidc-provider-like discovery metadata generator.
// Serves RFC 8414 (OAuth Authorization Server Metadata) + OpenID Connect
// Discovery 1.0. Both endpoints return the same metadata (this module
// is consumed by the .well-known routes).

import { resolveOAuthIssuer } from "@/lib/publicOrigin";

export async function getDiscoveryMetadata(request) {
  // issuer = <origin>/api/oauth — identical to what getProvider() is built with
  // and to the authorization_servers entry in the protected-resource docs.
  //
  // Every endpoint below is `${issuer}${route}`, where `route` is oidc-provider's
  // ACTUAL registered route name (see node_modules/oidc-provider/lib/helpers/
  // defaults.js `routes`): /auth, /token, /token/introspection, /token/revocation,
  // /reg, /jwks. These were previously advertised as /api/oauth/introspect,
  // /revoke, /register — paths oidc-provider's router does not serve, so
  // introspection, revocation, and dynamic client registration all 404'd.
  const issuer = resolveOAuthIssuer(request);

  return {
    issuer,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    introspection_endpoint: `${issuer}/token/introspection`,
    revocation_endpoint: `${issuer}/token/revocation`,
    registration_endpoint: `${issuer}/reg`,
    jwks_uri: `${issuer}/jwks`,

    scopes_supported: ["mcp"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    token_endpoint_auth_signing_alg_values_supported: [],
    introspection_endpoint_auth_methods_supported: ["bearer"],
    revocation_endpoint_auth_methods_supported: ["bearer"],
    code_challenge_methods_supported: ["S256"],

    // Public clients (no client_secret — PKCE replaces it)
    registration_management_endpoint: `${issuer}/reg`,
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    claim_types_supported: ["normal"],

    // Tell Claude that PKCE is required so it defaults to S256
    require_pushed_authorization_requests: false,
    require_request_uri_registration: false,
    dpop_signing_alg_values_supported: [],
    authorization_response_iss_parameter_supported: false,
  };
}