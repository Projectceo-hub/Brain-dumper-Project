// OAuth interaction page — the authorization server redirects here when the
// user has to log in and/or approve a connector.
//
// Flow:
//   GET /oauth/interact/<uid>
//     1. Load the pending authorization request for <uid>.
//     2. Check the current Supabase session (cookie-based SSR client).
//     3a. If not logged in → render email+password form (POST .../login)
//     3b. If logged in → render Authorize button (POST .../confirm)
//
// Step 1 is currently stubbed: oidc-provider has been removed and the
// replacement authorization server is not built yet. The UI below is the piece
// being reused, so it is left untouched.

import { isServiceRoleConfigured } from "@/lib/mcp/auth";
import { getAuthenticatedUser } from "@/lib/supabase/server";

// Friendly display names for known client_ids. If the client_id isn't in this
// map (e.g. a DCR-registered client we've never seen), we fall back to the
// raw id — better to show something honest than to pretend we know it.
const CLIENT_DISPLAY_NAMES = {
  "claude-ai-web": "Claude",
};

export default async function InteractPage({ params }) {
  if (!isServiceRoleConfigured()) {
    return <ErrorCard title="OAuth not configured" body="SUPABASE_SERVICE_ROLE_KEY is missing on the server. Ask the site operator to set it." />;
  }

  const { uid } = await params;
  if (!uid) {
    return <ErrorCard title="Invalid link" body="No interaction id was provided in the URL." />;
  }

  // TODO(oauth-rebuild): re-wire to the new Next.js authorization server.
  //
  // This used to load the interaction from oidc-provider via the _interaction
  // cookie. oidc-provider has been removed, and its replacement does not exist
  // yet, so there is nothing to read the pending authorization request from.
  // The presentation components below (LoginCard / AuthorizeCard) are kept
  // intact and unchanged — only this lookup needs replacing.
  const details = null;

  if (!details) {
    return (
      <ErrorCard
        title="Connector sign-in is temporarily unavailable"
        body="The MindCanvas OAuth server is being rebuilt. Try connecting again once it is back online."
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
