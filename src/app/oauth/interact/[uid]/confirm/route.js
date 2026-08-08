// POST /oauth/interact/<uid>/confirm
//
// Final step of the OAuth interaction: receives the Authorize (or Cancel)
// button submission from the interact page and completes the pending
// authorization request, redirecting back to the client's redirect_uri.
//
// TODO(oauth-rebuild): re-wire to the new Next.js authorization server.
// The oidc-provider implementation (provider.interactionDetails /
// provider.Grant / provider.interactionFinished) has been removed and its
// replacement does not exist yet, so this route currently completes nothing
// and reports 503. The form parsing and the session check below are the parts
// that carry over unchanged.
//
// SECURITY (must survive the rewrite): re-resolve the Supabase user from the
// cookie session inside this handler — do NOT trust the form submitter. The
// Authorize button is the consent affordance, but the account we authorize AS
// comes from the validated session, not from a hidden input or form param.

import { isServiceRoleConfigured } from "@/lib/mcp/auth";
import { getAuthenticatedUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  if (!isServiceRoleConfigured()) {
    return new Response("OAuth not configured", { status: 503 });
  }

  const { uid } = await params;
  if (!uid) {
    return new Response("Missing interaction uid", { status: 400 });
  }

  let confirmValue = "yes";
  try {
    const form = await request.formData();
    confirmValue = String(form.get("confirm") || "yes").toLowerCase();
  } catch {
    // empty body defaults to "yes" — matches an empty form submit, which
    // the Authorize button sends as confirm=yes
  }

  if (confirmValue === "yes") {
    const { user } = await getAuthenticatedUser();
    if (!user) {
      const loginUrl = new URL(`/oauth/interact/${uid}`, request.url);
      return Response.redirect(loginUrl.toString(), 303);
    }
  }

  return new Response(
    "The MindCanvas OAuth server is being rebuilt. Connector authorization is temporarily unavailable.",
    { status: 503 },
  );
}
