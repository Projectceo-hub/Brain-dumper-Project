// POST /oauth/interact/<uid>/login
//
// Receives the login form submission (email + password) from the interact page.
// Uses Supabase signInWithPassword via the cookie-based SSR client (so the
// resulting auth cookies are set on the response, propagating the session to
// the subsequent GET /oauth/interact/<uid> request). On success, redirects
// back to the same interact URL — which will now see a logged-in Supabase user
// and render the Authorize card instead of the Login card.
//
// Does NOT touch provider.js or the OAuth catch-all route. Only side-effect on
// the OAuth side is the Supabase session cookies set by createServerClient.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClientFromCookies } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const { uid } = await params;
  if (!uid) {
    return new Response("Missing interaction uid", { status: 400 });
  }

  // Parse the urlencoded form body. Next.js Request exposes a formData() helper
  // that handles both application/x-www-form-urlencoded and multipart/form-data.
  let email = "";
  let password = "";
  try {
    const form = await request.formData();
    email = String(form.get("email") || "").trim();
    password = String(form.get("password") || "");
  } catch (err) {
    return new Response(`Invalid form submission: ${err?.message || err}`, {
      status: 400,
    });
  }

  if (!email || !password) {
    return new Response("Email and password are required", { status: 400 });
  }

  const supabase = await createServerClientFromCookies();
  if (!supabase) {
    return new Response("Auth is not configured on the server", { status: 503 });
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Redirect back to the interact page with an error indicator in the query.
    // The interact page itself doesn't currently render the error inline
    // (kept minimal), but the 401 status + message tells callers what
    // happened. The user can re-submit the form.
    const loginUrl = new URL(`/oauth/interact/${uid}`, request.url);
    loginUrl.searchParams.set("error", "invalid_credentials");
    return Response.redirect(loginUrl.toString(), 303);
  }

  // Signed in — go back to the interact page. The next render will see the
  // Supabase session cookies and switch to the Authorize card.
  const nextUrl = new URL(`/oauth/interact/${uid}`, request.url);
  return Response.redirect(nextUrl.toString(), 303);
}
