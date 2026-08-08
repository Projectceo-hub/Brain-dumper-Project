// POST /oauth/interact/<uid>/login
//
// Verifies email + password against Supabase auth, then issues the short-lived
// signed `oauth_session` cookie the consent step reads. Uses the service-role
// client, so no app session cookie is created — proving your password here
// authorizes one connector approval, not a browser login.

import { isServiceRoleConfigured } from "@/lib/mcp/auth";
import { getServiceSupabase } from "@/lib/supabase/service";
import { redirectWithCookie, sessionCookieHeader } from "@/lib/oauth/session";

export const dynamic = "force-dynamic";

function backToConsent(request, uid, params = {}) {
  const url = new URL(`/oauth/interact/${uid}`, request.url);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function POST(request, { params }) {
  if (!isServiceRoleConfigured()) {
    return new Response("OAuth not configured", { status: 503 });
  }

  // uid comes from the path, not the body — a hidden form field is attacker
  // controlled and would let one interaction's login satisfy another.
  const { uid } = await params;
  if (!uid) {
    return new Response("Missing interaction uid", { status: 400 });
  }

  let email = "";
  let password = "";
  try {
    const form = await request.formData();
    email = String(form.get("email") || "").trim();
    password = String(form.get("password") || "");
  } catch {
    return Response.redirect(
      backToConsent(request, uid, { error: "invalid_request" }),
      303,
    );
  }

  if (!email || !password) {
    return Response.redirect(
      backToConsent(request, uid, { error: "invalid_credentials" }),
      303,
    );
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data?.user?.id) {
    return Response.redirect(
      backToConsent(request, uid, { error: "invalid_credentials" }),
      303,
    );
  }

  return redirectWithCookie(
    backToConsent(request, uid, { authenticated: "true" }),
    sessionCookieHeader(request, data.user.id),
  );
}
