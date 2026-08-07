// POST /oauth/interact/<uid>/confirm
//
// Final step of the OAuth interaction. Receives the Authorize (or Cancel)
// button submission and calls provider.interactionFinished() with the
// standard oidc-provider result shape:
//
//   {
//     login: { accountId: <supabase_user_id>, remember: false },
//     consent: {
//       rejectedScopes: [],
//       rejectedClaims: []
//     }
//   }
//
// On "Cancel" we pass an access_denied error instead, which oidc-provider
// surfaces back to the client at the redirect_uri via the standard
// `error=access_denied` query string.
//
// SECURITY: We re-resolve the Supabase user from the cookie session inside
// this handler — do NOT trust the form submitter. The Authorize button is
// the consent affordance, but the account we authorize AS comes from the
// validated session, not from a hidden input or form param.

import { cookies, headers } from "next/headers";
import { getProvider } from "@/lib/oauth/provider";
import { isServiceRoleConfigured } from "@/lib/mcp/auth";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { resolveOAuthIssuer } from "@/lib/publicOrigin";

export const dynamic = "force-dynamic";

// Same minimal Koa-style req/res shape used in the interact page.
// interactionFinished reads the _interaction cookie from req.headers and
// writes a Location header + status 303 to res via setHeader/end.
function fakeRequestFromHeaders(rawHeaders) {
  return {
    method: "POST",
    url: "/auth",
    headers: rawHeaders,
  };
}

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

  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();
  const rawHeaders = {
    host: (await headers()).get("host") || "localhost",
    cookie: allCookies.map((c) => `${c.name}=${c.value}`).join("; "),
  };

  let provider;
  try {
    provider = await getProvider(resolveOAuthIssuer(request));
  } catch (err) {
    return new Response(`OAuth server error: ${err?.message || err}`, {
      status: 500,
    });
  }

  // Reject consent without a live Supabase session — defense in depth.
  if (confirmValue === "yes") {
    const { user } = await getAuthenticatedUser();
    if (!user) {
      const loginUrl = new URL(`/oauth/interact/${uid}`, request.url);
      return Response.redirect(loginUrl.toString(), 303);
    }

    // The consent result must reference a persisted Grant.
    //
    // The previous shape ({ rejectedScopes, rejectedClaims }) is the pre-v7
    // API. On the installed version consent is expressed by saving a Grant
    // and returning its id, so the old shape granted no scopes at all — the
    // flow appeared to succeed and then issued a token that could access
    // nothing.
    let grantId;
    try {
      const details = await provider.interactionDetails(
        fakeRequestFromHeaders(rawHeaders),
        {
          setHeader() {}, getHeader() {}, removeHeader() {},
          writeHead() {}, write() {}, end() {},
          once() {}, on() {}, emit() {},
          get finished() { return false; },
        },
      );

      const clientId = details?.params?.client_id;
      const requestedScope = details?.params?.scope || "mcp";

      // Reuse an existing grant when the user re-authorizes the same client,
      // so repeat connections don't accumulate orphaned grants.
      let grant = details?.grantId
        ? await provider.Grant.find(details.grantId)
        : null;

      if (!grant) {
        grant = new provider.Grant({ accountId: user.id, clientId });
      }

      grant.addOIDCScope(requestedScope);
      grantId = await grant.save();
    } catch (err) {
      return new Response(
        `Could not record authorization: ${err?.message || err}`,
        { status: 400 },
      );
    }

    const result = {
      login: { accountId: user.id, remember: false },
      consent: { grantId },
    };

    // interactionFinished sets res.statusCode=303 and a Location header, then
    // calls res.end(). We capture the Location via the fakeRes fake.
    const fakeRes = {
      _statusCode: 200,
      _headers: {},
      setHeader(name, value) { this._headers[name.toLowerCase()] = String(value); },
      getHeader(name) { return this._headers[name.toLowerCase()]; },
      removeHeader(name) { delete this._headers[name.toLowerCase()]; },
      writeHead(code, headers = {}) {
        this._statusCode = code;
        Object.assign(this._headers, headers);
      },
      write() {},
      end() {},
      once() {},
      on() {},
      emit() {},
      get finished() { return true; },
    };

    try {
      await provider.interactionFinished(
        fakeRequestFromHeaders(rawHeaders),
        fakeRes,
        result,
      );
    } catch (err) {
      return new Response(`Authorization failed: ${err?.message || err}`, {
        status: 400,
      });
    }

    const returnTo = fakeRes._headers.location;
    if (!returnTo) {
      return new Response("OAuth server did not return a redirect URL", {
        status: 500,
      });
    }
    return Response.redirect(new URL(returnTo, request.url).toString(), 303);
  }

  // Cancel — tell oidc-provider the user denied access. The provider will
  // redirect back to the client with error=access_denied.
  const result = {
    error: "access_denied",
    error_description: "The user denied the authorization request.",
  };

  const fakeRes = {
    _statusCode: 200,
    _headers: {},
    setHeader(name, value) { this._headers[name.toLowerCase()] = String(value); },
    getHeader(name) { return this._headers[name.toLowerCase()]; },
    removeHeader(name) { delete this._headers[name.toLowerCase()]; },
    writeHead(code, headers = {}) {
      this._statusCode = code;
      Object.assign(this._headers, headers);
    },
    write() {},
    end() {},
    once() {},
    on() {},
    emit() {},
    get finished() { return true; },
  };

  try {
    await provider.interactionFinished(
      fakeRequestFromHeaders(rawHeaders),
      fakeRes,
      result,
    );
  } catch (err) {
    return new Response(`Could not cancel: ${err?.message || err}`, {
      status: 400,
    });
  }

  const returnTo = fakeRes._headers.location;
  if (!returnTo) {
    return new Response("OAuth server did not return a redirect URL", {
      status: 500,
    });
  }
  return Response.redirect(new URL(returnTo, request.url).toString(), 303);
}
