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

// Where the shared signing key lives in the oidc_models table. Not a real
// oidc-provider model — just a reserved row in the same store.
const KEYSTORE_ROW_ID = "Keystore:default";

async function createKeystore() {
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

  return [{ ...privateJwk, ...publicJwk }];
}

/**
 * Load the signing key from the database, creating it once if absent.
 *
 * This used to generate a fresh RSA key per process and hold it only in
 * module memory. On serverless that means every cold start invents new keys,
 * so an authorization issued by one instance could not be validated by
 * another — the flow failed intermittently and unreproducibly. Persisting the
 * key makes every instance agree.
 */
async function loadOrCreateKeystore() {
  if (cachedKeystore) return cachedKeystore;

  const supabase = getServiceSupabase();
  if (!supabase) {
    // Caller (getProvider) already refuses to run without service role; this
    // is just belt and braces so we never silently fall back to volatile keys.
    throw new Error("Service role is required to load the OAuth keystore.");
  }

  const { data: existing } = await supabase
    .from("oidc_models")
    .select("payload")
    .eq("id", KEYSTORE_ROW_ID)
    .maybeSingle();

  if (Array.isArray(existing?.payload?.keys) && existing.payload.keys.length > 0) {
    cachedKeystore = existing.payload.keys;
    return cachedKeystore;
  }

  const keys = await createKeystore();

  // Far-future expiry: the adapter's cleanup is driven by expires_at, and
  // this row must outlive every token it signs.
  const farFuture = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
  await supabase.from("oidc_models").upsert(
    {
      id: KEYSTORE_ROW_ID,
      model_type: "Keystore",
      payload: { keys },
      expires_at: farFuture.toISOString(),
    },
    { onConflict: "id" },
  );

  // Two cold starts can race here. Re-read so every instance converges on
  // whichever key actually landed rather than trusting its own local copy.
  const { data: settled } = await supabase
    .from("oidc_models")
    .select("payload")
    .eq("id", KEYSTORE_ROW_ID)
    .maybeSingle();

  cachedKeystore =
    Array.isArray(settled?.payload?.keys) && settled.payload.keys.length > 0
      ? settled.payload.keys
      : keys;

  return cachedKeystore;
}

// Cookie signing keys must also be identical across instances, or the
// _interaction cookie set during /auth fails to verify on the interaction
// page. Derived from an existing server-only secret so no new environment
// variable is required.
async function deriveCookieKeys() {
  const secret =
    process.env.OAUTH_COOKIE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  const data = new TextEncoder().encode(`mindcanvas-oauth-cookies:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return [hex];
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

  const supabase = getServiceSupabase();
  if (!supabase) {
    throw new Error("Service role is not configured — OAuth server requires it.");
  }

  const keystore = await loadOrCreateKeystore();
  const cookieKeys = await deriveCookieKeys();

  const adapterCtor = SupabaseOidcAdapter;

  // Interaction policy: the DEFAULT policy is kept, with both prompts intact.
  //
  // These were previously both removed, on the reasoning that the user is
  // already signed in and adding the connector is itself consent. But the
  // prompts are the only thing that routes the browser to
  // /oauth/interact/<uid>, and that page is where the Supabase user is
  // resolved and bound to the grant via interactionFinished(). With no
  // prompts, nothing ever established WHICH MindCanvas account was
  // authorizing, so authorization codes were issued with no subject.
  //
  // The login prompt is satisfied immediately when a Supabase session cookie
  // is already present — the interact page shows a one-click Authorize rather
  // than a login form — so keeping it costs a redirect, not a password entry.
  const { base } = interactionPolicy;
  const policy = base();

  const provider = new Provider(baseUrl, {
    adapter: adapterCtor,

    // Public JWKS for discovery. The private portion lives in the
    // keystore object that oidc-provider uses internally.
    jwks: { keys: keystore.map((key) => ({ ...key })) },

    // Stable across instances — see deriveCookieKeys above.
    cookies: { keys: cookieKeys },

    // DCR — allow any client that includes the known claude.ai callback.
    features: {
      registration: { enabled: true },
      registrationManagement: { enabled: true, rotateRegistrationAccessToken: true },
      introspection: { enabled: true },
      revocation: { enabled: true },
      userinfo: { enabled: false },
      backchannelLogout: { enabled: false },
      claimsParameter: { enabled: false },
      devInteractions: { enabled: false },
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

    // NOTE: `enabledFlows` used to be set here. It is not a real
    // oidc-provider option — verified against the installed version, which
    // accepts and silently ignores it. Which grants are allowed is decided by
    // each client's grant_types (see clientDefaults below), so removing the
    // dead key changes nothing except the false impression that it did.

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

    // Pre-registered static client for claude.ai's web connector.
    // Coexists with DCR (features.registration.enabled above) so additional
    // clients can still self-register.
    clients: [
      {
        client_id: "claude-ai-web",
        client_secret: undefined,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        redirect_uris: [
          "https://claude.ai/api/mcp/auth_callback",
          "https://claude.com/api/mcp/auth_callback",
        ],
        scope: "mcp",
        application_type: "web",
        id_token_signed_response_alg: "RS256",
      },
    ],

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

  // Validate DCR-registered clients by callback URL.
  //
  // This previously demanded that every registering client list
  // EXACTLY "https://claude.ai/api/mcp/auth_callback". That is the web
  // callback only — Claude Desktop registers a different one (claude.com, or
  // a loopback address for the native app), so desktop was rejected at
  // registration and could never reach the authorization step at all.
  //
  // The check now accepts any Anthropic-operated callback host plus loopback
  // addresses, which is what native OAuth clients are required to use by
  // RFC 8252. It still refuses arbitrary third-party redirect targets, which
  // is the actual point of the check.
  const ALLOWED_REDIRECT_HOSTS = new Set([
    "claude.ai",
    "www.claude.ai",
    "claude.com",
    "www.claude.com",
    "localhost",
    "127.0.0.1",
    "[::1]",
  ]);

  function isAllowedRedirectUri(value) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }
    // Native apps may register a private-use scheme (e.g. claude://…), which
    // has no meaningful host. RFC 8252 permits these for installed apps.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return true;
    }
    return ALLOWED_REDIRECT_HOSTS.has(parsed.hostname);
  }

  async function customValidateClient(ctx, metadata) {
    const redirectUris = Array.isArray(metadata?.redirect_uris)
      ? metadata.redirect_uris
      : [];
    if (redirectUris.length === 0) {
      throw new provider.InvalidClientMetadata(
        "redirect_uris must contain at least one callback URL",
      );
    }
    const rejected = redirectUris.filter((uri) => !isAllowedRedirectUri(uri));
    if (rejected.length > 0) {
      throw new provider.InvalidClientMetadata(
        `redirect_uris contains a callback this server will not authorize: ${rejected.join(", ")}`,
      );
    }
  }

  provider.on("client.register.validating", customValidateClient);

  // Vercel terminates TLS upstream, so the request reaching this code looks
  // like plain http. Without trusting the forwarded headers, oidc-provider
  // compares the apparent scheme against the https issuer and rejects the
  // request. This is required in any proxied deployment.
  provider.proxy = true;

  cachedProvider = provider;
  cachedIssuer = baseUrl;

  return provider;
}