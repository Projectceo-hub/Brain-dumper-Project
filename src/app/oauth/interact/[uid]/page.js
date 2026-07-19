// OAuth interaction page — oidc-provider redirects here when the auto-approve
// policy decides an interaction is needed (e.g. config changes re-enable the
// login/consent prompts, or future code opts into them).
//
// Flow:
//   GET /oauth/interact/<uid>
//     1. Read interaction details from oidc-provider via the _interaction cookie
//        that oidc-provider set when it redirected here.
//     2. Check the current Supabase session (cookie-based SSR client).
//     3a. If not logged in → render email+password form (POST /api... see login route)
//     3b. If logged in → render Authorize button (POST to /oauth/interact/<uid>/confirm)
//
// Critical: this page must NOT create a new Provider instance — use getProvider()
// from src/lib/oauth/provider. The provider expects Koa-style req/res; we build
// the same fakeReq/fakeRes shape used by /api/oauth/[[...path]]/route.js.

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getProvider } from "@/lib/oauth/provider";
import { isServiceRoleConfigured } from "@/lib/mcp/auth";
import { createServerClientFromCookies, getAuthenticatedUser } from "@/lib/supabase/server";

// Friendly display names for known client_ids. If the client_id isn't in this
// map (e.g. a DCR-registered client we've never seen), we fall back to the
// raw id — better to show something honest than to pretend we know it.
const CLIENT_DISPLAY_NAMES = {
  "claude-ai-web": "Claude",
};

function buildOrigin(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

// Minimal Koa-style req shape for oidc-provider's interactionDetails().
// Only `headers` matters here — interactionDetails only reads the
// _interaction cookie from req.headers.cookie. We don't need a body stream
// on a GET.
function fakeRequestFromHeaders(rawHeaders) {
  return {
    method: "GET",
    url: "/auth",
    headers: rawHeaders,
  };
}

export default async function InteractPage({ params }) {
  if (!isServiceRoleConfigured()) {
    return <ErrorCard title="OAuth not configured" body="SUPABASE_SERVICE_ROLE_KEY is missing on the server. Ask the site operator to set it." />;
  }

  const { uid } = await params;
  if (!uid) {
    return <ErrorCard title="Invalid link" body="No interaction id was provided in the URL." />;
  }

  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();
  const rawHeaders = {
    host: (await headers()).get("host") || "localhost",
    cookie: allCookies.map((c) => `${c.name}=${c.value}`).join("; "),
  };

  const request = {
    url: `https://${rawHeaders.host}/oauth/interact/${uid}`,
  };

  let details;
  let interactionError = "";
  try {
    const provider = await getProvider(buildOrigin(request));
    const fakeReq = fakeRequestFromHeaders(rawHeaders);
    const fakeRes = {
      _statusCode: 200,
      _headers: {},
      setHeader(name, value) { this._headers[name.toLowerCase()] = value; },
      getHeader(name) { return this._headers[name.toLowerCase()]; },
      removeHeader(name) { delete this._headers[name.toLowerCase()]; },
      writeHead() {},
      write() {},
      end() {},
      once() {},
      on() {},
      emit() {},
      get finished() { return false; },
    };
    details = await provider.interactionDetails(fakeReq, fakeRes);
  } catch (err) {
    interactionError = err?.message || "Unknown error";
  }

  if (!details) {
    return (
      <ErrorCard
        title="This link has expired"
        body={
          interactionError
            ? `Details: ${interactionError}`
            : "Interaction sessions only last a few minutes. Go back to the app you were connecting from and start again."
        }
      />
    );
  }

  // Resolve the current MindCanvas (Supabase) user from the browser session.
  const { user } = await getAuthenticatedUser();

  const interactionParams = details.params || {};
  const clientId = interactionParams.client_id || "unknown";
  const clientName = CLIENT_DISPLAY_NAMES[clientId] || clientId;
  const promptName = details?.prompt?.name;

  // If user is logged in AND prompt requires login (or there's no prompt),
  // skip to showing the authorize screen. If neither login nor consent is
  // required, just confirm.
  const showLogin = !user || promptName === "login";
  const redirectUri = interactionParams.redirect_uri || "https://claude.ai";

  if (showLogin) {
    return (
      <InteractShell>
        <LoginCard uid={uid} clientName={clientName} redirectUri={redirectUri} />
      </InteractShell>
    );
  }

  return (
    <InteractShell>
      <AuthorizeCard uid={uid} clientName={clientName} redirectUri={redirectUri} />
    </InteractShell>
  );
}

function InteractShell({ children }) {
  return (
    <main className="min-h-screen bg-bone px-5 py-10 flex items-center justify-center">
      <section className="w-full max-w-sm">{children}</section>
    </main>
  );
}

function ErrorCard({ title, body }) {
  return (
    <InteractShell>
      <p className="font-sans text-warm-gray-light text-xs uppercase tracking-widest font-semibold">
        MindCanvas
      </p>
      <h1 className="font-serif text-ink text-3xl font-bold tracking-tight mt-2">
        {title}
      </h1>
      <p className="font-sans text-warm-gray text-sm mt-3 leading-relaxed">
        {body}
      </p>
    </InteractShell>
  );
}

function LoginCard({ uid, clientName, redirectUri }) {
  return (
    <>
      <p className="font-sans text-warm-gray-light text-xs uppercase tracking-widest font-semibold">
        MindCanvas
      </p>
      <h1 className="font-serif text-ink text-4xl font-bold tracking-tight mt-2">
        Welcome back
      </h1>
      <p className="font-sans text-warm-gray text-sm mt-2 leading-relaxed">
        Log in to MindCanvas to authorize{" "}
        <span className="font-semibold text-ink">{clientName}</span> to access your notes.
      </p>

      <form action={`/oauth/interact/${uid}/login`} method="POST" className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-sans text-xs uppercase tracking-widest text-warm-gray-light font-semibold">
            Email
          </span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="w-full rounded-xl border border-warm-gray-light/40 bg-white/70 px-4 py-3 font-sans text-ink outline-none focus:border-clay"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-sans text-xs uppercase tracking-widest text-warm-gray-light font-semibold">
            Password
          </span>
          <input
            type="password"
            name="password"
            required
            minLength={6}
            autoComplete="current-password"
            className="w-full rounded-xl border border-warm-gray-light/40 bg-white/70 px-4 py-3 font-sans text-ink outline-none focus:border-clay"
          />
        </label>

        <button
          type="submit"
          className="mt-2 rounded-full bg-clay px-6 py-3 font-sans text-sm font-semibold text-bone shadow-md transition-all hover:bg-clay/90 active:scale-[0.98] disabled:opacity-60"
        >
          Log in and continue
        </button>
      </form>

      <p className="font-sans text-xs text-warm-gray mt-5 leading-relaxed">
        After {clientName} is connected, you can revoke access anytime by visiting your tokens page.
      </p>
    </>
  );
}

function AuthorizeCard({ uid, clientName, redirectUri }) {
  return (
    <>
      <p className="font-sans text-warm-gray-light text-xs uppercase tracking-widest font-semibold">
        MindCanvas
      </p>
      <h1 className="font-serif text-ink text-3xl font-bold tracking-tight mt-2">
        Authorize {clientName}
      </h1>
      <p className="font-sans text-warm-gray text-sm mt-3 leading-relaxed">
        <span className="font-semibold text-ink">{clientName}</span> wants to access your MindCanvas notes — read, search, create, and organize. This token only grants access to <span className="font-semibold">your</span> data, scoped to your account.
      </p>

      <form action={`/oauth/interact/${uid}/confirm`} method="POST" className="mt-8 flex flex-col gap-3">
        <button
          type="submit"
          name="confirm"
          value="yes"
          className="rounded-full bg-clay px-6 py-3 font-sans text-sm font-semibold text-bone shadow-md transition-all hover:bg-clay/90 active:scale-[0.98]"
        >
          Authorize
        </button>
        <button
          type="submit"
          name="confirm"
          value="no"
          className="rounded-full border border-warm-gray-light/40 bg-transparent px-6 py-3 font-sans text-sm font-semibold text-warm-gray hover:text-ink transition-colors active:scale-[0.98]"
        >
          Cancel
        </button>
      </form>

      <p className="font-sans text-xs text-warm-gray mt-5 leading-relaxed">
        Redirecting back to <span className="font-mono">{redirectUri}</span>.
      </p>
    </>
  );
}
