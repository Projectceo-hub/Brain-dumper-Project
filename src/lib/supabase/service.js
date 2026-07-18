import { createClient } from "@supabase/supabase-js";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

function hasServiceRole() {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
}

let serviceClient = null;

/**
 * Returns a Supabase client that bypasses RLS by using the project's
 * service role key. This is ONLY safe to use in server-only code paths
 * (Next.js API routes, server components). NEVER import this module into
 * a "use client" file or expose the client to the browser.
 *
 * The MCP server uses this client to:
 *   1. Verify an incoming Bearer token's hash against api_tokens (a lookup
 *      that's impossible under RLS because external MCP clients have no
 *      Supabase session).
 *   2. Read/write folders/notes scoped explicitly by user_id, since the
 *      token lookup gives us a validated user_id that we must enforce
 *      manually at the query level.
 *
 * SECURITY: Every query that traverses user-owned data MUST include
 * `.eq("user_id", userId)` — bypassing RLS at the connection level without
 * scoping at the query level would expose other users' data.
 */
export function getServiceSupabase() {
  if (!hasServiceRole()) {
    return null;
  }
  if (!serviceClient) {
    serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serviceClient;
}

export function isServiceRoleConfigured() {
  return hasServiceRole();
}
