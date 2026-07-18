// oidc-provider-like discovery metadata generator.
// Serves RFC 8414 (OAuth Authorization Server Metadata) + OpenID Connect
// Discovery 1.0. Both endpoints return the same metadata (this module
// is consumed by the .well-known routes).

export async function getDiscoveryMetadata(request) {
  const url = new URL(request.url);
  const issuer = `${url.protocol}//${url.host}`;

  return {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/auth`,
    token_endpoint: `${issuer}/api/oauth/token`,
    introspection_endpoint: `${issuer}/api/oauth/introspect`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    jwks_uri: `${issuer}/api/oauth/jwks`,

    scopes_supported: ["mcp"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    token_endpoint_auth_signing_alg_values_supported: [],
    introspection_endpoint_auth_methods_supported: ["bearer"],
    revocation_endpoint_auth_methods_supported: ["bearer"],
    code_challenge_methods_supported: ["S256"],

    // Public clients (no client_secret — PKCE replaces it)
    registration_management_endpoint: `${issuer}/api/oauth/register`,
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