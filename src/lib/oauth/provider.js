// oidc-provider configuration for MindCanvas's MCP OAuth server.
// Creates a Provider instance with:
// - DCR enabled (claude.ai registers as a client on first connection)
// - PKCE required (S256, per MCP authorization spec)
// - Refresh token rotation enabled (OAuth 2.1 security requirement)
// - Custom Supabase adapter to persist state across stateless requests
// - Generated ephemeral JWKS (short-lived tokens, safe on serverless cold starts)

import Provider from "oidc-provider";
import { interactionPolicy } from "oidc-provider";
import { SupabaseOidcAdapter } from "@/lib/oauth/adapter";
import { getServiceSupabase } from "@/lib/supabase/service";

let cachedKeystore = null;
let cachedProvider = null;
let cachedIssuer = null;

async function generateKeystore() {
  if (cachedKeystore) return cachedKeystore;

  const signingKeypair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  const publicJwk = await crypto.subtle.exportKey("jwk", signingKeypair.publicKey);
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";

  const privateJwk = await crypto.subtle.exportKey("jwk", signingKeypair.privateKey);
  privateJwk.use = "sig";
  privateJwk.alg = "RS256";

  const kid = crypto.randomUUID().replace(/-/g, "");
  publicJwk.kid = kid;
  privateJwk.kid = kid;

  cachedKeystore = [{ ...privateJwk, ...publicJwk }];

  return cachedKeystore;
}

/**
 * Build or retrieve the cached oidc-provider instance.
 * Safe to call once per request because caching prevents repeated
 * RSA generation on each cold-start hit.
 */
export async function getProvider(baseUrl) {
  if (!baseUrl) {
    throw new Error("getProvider requires a baseUrl (issuer origin).");
  }

  if (cachedProvider && cachedIssuer === baseUrl) {
    return cachedProvider;
  }

  const keystore = await generateKeystore();

  const supabase = getServiceSupabase();
  if (!supabase) {
    throw new Error("Service role is not configured — OAuth server requires it.");
  }

  const adapterCtor = SupabaseOidcAdapter;

  // Interaction policy: auto-approve for MCP use case.
  // The user explicitly initiates the connection on claude.ai, so we don't
  // need a login screen (they're already authenticated) or a consent screen
  // (the act of adding the connector IS consent).
  const { base } = interactionPolicy;
  const policy = base();
  policy.remove("login");  // No login prompt - user is already the MindCanvas user
  policy.remove("consent"); // No consent prompt - user initiated the connector

  const provider = new Provider(baseUrl, {
    adapter: adapterCtor,

    // Public JWKS for discovery. The private portion lives in the
    // keystore object that oidc-provider uses internally.
    jwks: { keys: keystore.map((key) => ({ ...key })) },

    // Cookie signing keys (required for session cookies during
    // interactive OIDC flows — even if we auto-approve, oidc-provider
    // expects this to be set).
    cookies: { keys: [crypto.randomUUID().replace(/-/g, "")] },

    // DCR — allow any client that includes the known claude.ai callback.
    features: {
      registration: { enabled: true },
      registrationManagement: { enabled: true, rotateRegistrationAccessToken: true },
      introspection: { enabled: true },
      revocation: { enabled: true },
      userinfo: { enabled: false },
      backchannelLogout: { enabled: false },
      claimsParameter: { enabled: false },
    },

    // PKCE required, S256 only (per MCP authorization spec).
    pkce: {
      required: () => true,
      methods: ["S256"],
    },

    // Refresh token rotation — rotate every refresh, return new token.
    rotateRefreshToken: async () => true,

    // Scopes — just "mcp" (read/write notes). No openid/profile/email.
    scopes: ["mcp"],

    // Only authorization_code grant + refresh_token. No implicit, no
    // client_credentials, no device flow.
    enabledFlows: ["authorization_code"],

    // Token lifetimes (seconds):
    ttl: {
      AccessToken: 600,        // 10 minutes
      AuthorizationCode: 300,  // 5 minutes
      RefreshToken: 2592000,   // 30 days
      Grant: 2592000,
      Session: 2592000,
    },

    // Client defaults for DCR-registered clients:
    clientDefaults: {
      application_type: "web",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",       // public client — PKCE replaces client_secret
      id_token_signed_response_alg: "RS256",
    },

    // Interaction policy — auto-approve for MCP connector flow.
    interactions: {
      policy,
      // The interaction URL is never hit because policy has no prompts,
      // but oidc-provider requires it to be defined.
      url: (ctx) => `/oauth/interact/${ctx.oidc.uid}`,
    },

    // Custom client validation — only allow clients whose redirect_uris
    // include the known claude.ai callback.
    extraClientMetadata: {
      properties: ["software_id", "software_version"],
    },

    // Render errors as JSON (no HTML login pages).
    renderError: async (ctx, out, error) => {
      out.statusCode = error.statusCode || 400;
      out.body = JSON.stringify({
        error: error.error || "server_error",
        error_description: error.error_description || error.message,
      });
      out.headers = { "Content-Type": "application/json" };
    },
  });

  // Validate that DCR-registered clients include the required callback URL.
  const REQUIRED_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

  async function customValidateClient(ctx, metadata) {
    const redirectUris = Array.isArray(metadata?.redirect_uris)
      ? metadata.redirect_uris
      : [];
    if (!redirectUris.includes(REQUIRED_REDIRECT_URI)) {
      throw new provider.InvalidClientMetadata(
        `redirect_uris must include ${REQUIRED_REDIRECT_URI} for claude.ai web connector`,
      );
    }
  }

  provider.on("client.register.validating", customValidateClient);

  cachedProvider = provider;
  cachedIssuer = baseUrl;

  return provider;
}