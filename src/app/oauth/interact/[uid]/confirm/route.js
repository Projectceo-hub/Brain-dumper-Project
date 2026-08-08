// POST /oauth/interact/<uid>/confirm
//
// Records consent: converts the pending `interact_<uid>` row in oauth_codes
// into a real authorization code stamped with the approving user's id, then
// redirects back to the client with ?code=&state=.
//
// SECURITY: both the account and the redirect target come from server-side
// state — the signed cookie and the pending row — never from the form. A
// submitted redirect_uri is only ever compared against the stored one; if it
// were trusted, anyone could POST here and have a valid code for the signed-in
// user delivered to their own server.

import crypto from "node:crypto";
import { isServiceRoleConfigured } from "@/lib/mcp/auth";
import { getServiceSupabase } from "@/lib/supabase/service";
import { CODES_TABLE, PENDING_CODE_PREFIX } from "@/lib/oauth/shared";
import {
  OAUTH_SESSION_COOKIE,
  clearSessionCookieHeader,
  readSessionValue,
  redirectWithCookie,
} from "@/lib/oauth/session";

export const dynamic = "force-dynamic";

// Codes are single-use and live 5 minutes: long enough for the client's token
// call, short enough that a leaked code is stale before it is useful.
const CODE_TTL_MS = 5 * 60 * 1000;

function redirectTo(base, params, cookie) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return redirectWithCookie(url.toString(), cookie);
}

export async function POST(request, { params }) {
  if (!isServiceRoleConfigured()) {
    return new Response("OAuth not configured", { status: 503 });
  }

  const { uid } = await params;
  if (!uid) {
    return new Response("Missing interaction uid", { status: 400 });
  }

  const cookieHeader = request.headers.get("cookie") || "";
  const rawSession = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${OAUTH_SESSION_COOKIE}=`))
    ?.slice(OAUTH_SESSION_COOKIE.length + 1);

  const userId = readSessionValue(decodeURIComponent(rawSession || ""));
  if (!userId) {
    return new Response("Not signed in for this authorization request.", {
      status: 401,
    });
  }

  let confirmValue = "yes";
  let submittedRedirectUri = "";
  try {
    const form = await request.formData();
    confirmValue = String(form.get("confirm") || "yes").toLowerCase();
    submittedRedirectUri = String(form.get("redirect_uri") || "");
  } catch {
    // An empty body is the Authorize button's minimal submit — treat as yes.
  }

  const supabase = getServiceSupabase();
  const pendingCode = `${PENDING_CODE_PREFIX}${uid}`;

  const { data: row, error } = await supabase
    .from(CODES_TABLE)
    .select("code, redirect_uri, state, expires_at, user_id")
    .eq("code", pendingCode)
    .maybeSingle();

  if (error || !row) {
    return new Response(
      "This authorization request has expired or was already completed.",
      { status: 400 },
    );
  }

  // Everything below can redirect: the stored redirect_uri was already
  // exact-matched against the client's registration at /api/oauth/auth.
  const target = row.redirect_uri;
  const state = row.state || "";
  const clearCookie = clearSessionCookieHeader(request);

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await supabase.from(CODES_TABLE).delete().eq("code", pendingCode);
    return redirectTo(
      target,
      {
        error: "access_denied",
        error_description: "The authorization request expired.",
        state,
      },
      clearCookie,
    );
  }

  if (submittedRedirectUri && submittedRedirectUri !== target) {
    return new Response("redirect_uri does not match this authorization request.", {
      status: 400,
    });
  }

  if (confirmValue !== "yes") {
    await supabase.from(CODES_TABLE).delete().eq("code", pendingCode);
    return redirectTo(
      target,
      {
        error: "access_denied",
        error_description: "The user denied the authorization request.",
        state,
      },
      clearCookie,
    );
  }

  const realCode = crypto.randomBytes(32).toString("hex");

  // `.is("user_id", null)` makes the update the atomic claim on this pending
  // row: a double submit finds nothing to update and cannot mint a second code.
  const { data: updated, error: updateError } = await supabase
    .from(CODES_TABLE)
    .update({
      code: realCode,
      user_id: userId,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    })
    .eq("code", pendingCode)
    .is("user_id", null)
    .select("code");

  if (updateError || !updated || updated.length === 0) {
    console.error(
      "[oauth] consent update failed:",
      updateError?.message || "pending row already claimed",
    );
    return redirectTo(
      target,
      {
        error: "server_error",
        error_description: "Could not record the authorization.",
        state,
      },
      clearCookie,
    );
  }

  return redirectTo(target, { code: realCode, state }, clearCookie);
}
