import { getServiceSupabase, isServiceRoleConfigured } from "@/lib/supabase/service";

const TOKEN_PREFIX_LEN = 8;

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function makeOpaqueToken() {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  let out = "mc_";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export function getTokenPrefix(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return "";
  return rawToken.slice(0, TOKEN_PREFIX_LEN);
}

/**
 * Persist a new API token for the given user. Returns the raw token exactly
 * once; the caller must show it to the user immediately because the database
 * only stores the SHA-256 hash + 8-char prefix.
 */
export async function createTokenForUser(userId, label = "default") {
  const supabase = getServiceSupabase();
  if (!supabase) {
    throw new Error("Service role is not configured.");
  }
  if (!userId) {
    throw new Error("createTokenForUser requires a userId.");
  }

  const rawToken = makeOpaqueToken();
  const tokenHash = await sha256(rawToken);
  const tokenPrefix = getTokenPrefix(rawToken);

  const { error } = await supabase.from("api_tokens").insert({
    user_id: userId,
    label,
    token_hash: tokenHash,
    token_prefix: tokenPrefix,
  });

  if (error) {
    throw new Error(`Failed to create token: ${error.message}`);
  }

  return {
    token: rawToken,
    label,
    tokenPrefix,
  };
}

export async function listTokensForUser(userId) {
  const supabase = getServiceSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("api_tokens")
    .select("id, label, token_prefix, created_at, last_used_at, revoked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data || [];
}

export async function revokeToken(userId, tokenId) {
  const supabase = getServiceSupabase();
  if (!supabase) return false;
  const { error } = await supabase
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", tokenId);
  return !error;
}

/**
 * Verify an Authorization: Bearer <token> header value against the stored
 * api_tokens table. Returns the owning user_id on success, or null if the
 * token is missing, revoked, or unknown. Also bumps last_used_at on success.
 *
 * NEVER returns a token row — only the validated user_id.
 */
export async function resolveUserFromBearer(authHeader) {
  if (!authHeader || typeof authHeader !== "string") return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const rawToken = match[1].trim();
  if (!rawToken) return null;

  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const tokenHash = await sha256(rawToken);

  const { data, error } = await supabase
    .from("api_tokens")
    .select("id, user_id, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;

  await supabase
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return data.user_id;
}

export { isServiceRoleConfigured };
