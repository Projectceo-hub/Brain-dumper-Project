// OAuth consent page — GET /oauth/interact/<uid>
//
// /api/oauth/auth parks the client's authorization request in oauth_codes as
// `interact_<uid>` and sends the browser here. This page loads that row (the
// authoritative copy — query params are display hints only), then shows:
//   • the login form, until a signed oauth_session cookie exists
//   • the Authorize screen once it does
//
// Consent is recorded by POST .../confirm.

import { cookies } from "next/headers";
import { isServiceRoleConfigured } from "@/lib/mcp/auth";
import { getServiceSupabase } from "@/lib/supabase/service";
import { CODES_TABLE, PENDING_CODE_PREFIX, findClient } from "@/lib/oauth/shared";
import { OAUTH_SESSION_COOKIE, readSessionValue } from "@/lib/oauth/session";

export const dynamic = "force-dynamic";

/**
 * Load the pending authorization request, or null if it is missing or expired.
 * Kept out of the component body: the clock read belongs to the data fetch,
 * not to render.
 */
async function loadPendingRequest(supabase, uid) {
  const { data } = await supabase
    .from(CODES_TABLE)
    .select("client_id, redirect_uri, state, scope, expires_at, user_id")
    .eq("code", `${PENDING_CODE_PREFIX}${uid}`)
    .maybeSingle();

  if (!data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  return data;
}

export default async function InteractPage({ params, searchParams }) {
  if (!isServiceRoleConfigured()) {
    return <ErrorCard title="OAuth not configured" body="SUPABASE_SERVICE_ROLE_KEY is missing on the server. Ask the site operator to set it." />;
  }

  const { uid } = await params;
  const query = (await searchParams) || {};
  if (!uid) {
    return <ErrorCard title="Invalid link" body="No interaction id was provided in the URL." />;
  }

  const supabase = getServiceSupabase();
  const pending = await loadPendingRequest(supabase, uid);

  if (!pending) {
    return (
      <ErrorCard
        title="This link has expired"
        body="Authorization requests only last a few minutes. Go back to the app you were connecting from and start again."
      />
    );
  }

  const client = await findClient(supabase, pending.client_id);
  const clientName = client?.client_name || pending.client_id;

  // The signed cookie — not ?authenticated=true — decides which screen renders.
  // The query param is a spoofable hint; the cookie is what /confirm verifies.
  const cookieStore = await cookies();
  const userId = readSessionValue(
    cookieStore.get(OAUTH_SESSION_COOKIE)?.value || "",
  );

  if (!userId) {
    return (
      <InteractShell>
        <LoginCard
          uid={uid}
          clientName={clientName}
          failed={query.error === "invalid_credentials"}
        />
      </InteractShell>
    );
  }

  return (
    <InteractShell>
      <AuthorizeCard
        uid={uid}
        clientName={clientName}
        redirectUri={pending.redirect_uri}
        state={pending.state || ""}
      />
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

function LoginCard({ uid, clientName, failed }) {
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

      {failed ? (
        <p className="font-sans text-sm mt-4 rounded-xl border border-clay/40 bg-clay/10 px-4 py-3 text-ink">
          That email and password didn&apos;t match. Try again.
        </p>
      ) : null}

      <form action={`/oauth/interact/${uid}/login`} method="POST" className="mt-8 flex flex-col gap-4">
        <input type="hidden" name="uid" value={uid} />
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

function AuthorizeCard({ uid, clientName, redirectUri, state }) {
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
        <input type="hidden" name="uid" value={uid} />
        <input type="hidden" name="redirect_uri" value={redirectUri} />
        <input type="hidden" name="state" value={state} />
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
