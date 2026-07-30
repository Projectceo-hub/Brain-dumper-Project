"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { clearActiveSyncUser, initializeSyncForUser } from "@/lib/db";
import RouteTransition from "@/components/RouteTransition";

function AuthScreen() {
  const supabase = createClient();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isSignup = mode === "signup";

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const credentials = {
        email: email.trim(),
        password,
      };

      const { data, error: authError } = isSignup
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword(credentials);

      if (authError) {
        setError(authError.message);
        return;
      }

      if (isSignup && !data.session) {
        setMessage("Check your email to confirm your account, then log in.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-bone px-5 py-10 flex items-center justify-center">
      <section className="w-full max-w-sm">
        <p className="font-sans text-warm-gray-light text-xs uppercase tracking-widest font-semibold">
          MindCanvas
        </p>
        <h1 className="font-serif text-ink text-4xl font-bold tracking-tight mt-2">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="font-sans text-warm-gray text-sm mt-2 leading-relaxed">
          Use email and password so your notes follow you across devices.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="font-sans text-xs uppercase tracking-widest text-warm-gray-light font-semibold">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
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
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
              autoComplete={isSignup ? "new-password" : "current-password"}
              className="w-full rounded-xl border border-warm-gray-light/40 bg-white/70 px-4 py-3 font-sans text-ink outline-none focus:border-clay"
            />
          </label>

          {error && (
            <p className="rounded-xl bg-clay/10 px-4 py-3 font-sans text-sm text-clay">
              {error}
            </p>
          )}

          {message && (
            <p className="rounded-xl bg-sage px-4 py-3 font-sans text-sm text-pine">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-full bg-clay px-6 py-3 font-sans text-sm font-semibold text-bone shadow-md transition-all hover:bg-clay/90 active:scale-[0.98] disabled:opacity-60"
          >
            {loading
              ? "Please wait..."
              : isSignup
                ? "Sign up"
                : "Log in"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(isSignup ? "login" : "signup");
            setError("");
            setMessage("");
          }}
          className="mt-5 font-sans text-sm text-warm-gray hover:text-ink transition-colors"
        >
          {isSignup
            ? "Already have an account? Log in"
            : "Need an account? Sign up"}
        </button>
      </section>
    </main>
  );
}

function ConfigMissing() {
  return (
    <main className="min-h-screen bg-bone px-5 py-10 flex items-center justify-center">
      <section className="w-full max-w-sm">
        <p className="font-sans text-warm-gray-light text-xs uppercase tracking-widest font-semibold">
          Setup needed
        </p>
        <h1 className="font-serif text-ink text-3xl font-bold mt-2">
          Supabase is not configured
        </h1>
        <p className="font-sans text-warm-gray text-sm mt-3 leading-relaxed">
          Add `NEXT_PUBLIC_SUPABASE_URL` and
          `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the environment.
        </p>
      </section>
    </main>
  );
}

export default function AuthGate({ children }) {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(configured);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const lastSyncedUserIdRef = useRef(null);
  // The onAuthStateChange callback below is registered once (deps: []), so
  // any `session` it reads from the render closure is frozen at the
  // first-render value (null) forever. Reading the live value through a ref
  // is the only way that callback can ask "did we have a session?" — see
  // the STALE-CLOSURE note at the `userIdCleared` computation.
  const sessionRef = useRef(null);

  useEffect(() => {
    if (!configured) {
      return;
    }

    const supabase = createClient();
    let mounted = true;

    async function loadSession() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      sessionRef.current = data.session ?? null;
      setSession(data.session ?? null);

      // Only run initial sync when we actually have a new user id. The
      // previous behaviour ran sync on every visibility-triggered getSession
      // call — this is what caused the "page reloads on tab return" symptom.
      const userId = data.session?.user?.id;
      if (userId && userId !== lastSyncedUserIdRef.current) {
        lastSyncedUserIdRef.current = userId;
        if (navigator.onLine) {
          setSyncing(true);
          try {
            await initializeSyncForUser(userId);
          } catch (error) {
            console.error("Initial sync failed:", error);
            setSyncError("Some notes are local only. Sync will retry when online.");
          } finally {
            if (mounted) {
              setSyncing(false);
            }
          }
        } else {
          // Offline — skip sync, Dexie already has the cached data
          setSyncing(false);
        }
      }

      setLoading(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      // DATA-LOSS-RACE FIX (Phase 6 Part C follow-up).
      //
      // Background: Supabase's auth client subscribes to
      // `window.visibilitychange` (see @supabase/auth-js GoTrueClient.js
      // ~line 4636). Returning to a tab triggers a token refresh, which
      // fires a SEQUENCE of onAuthStateChange events in quick order. The
      // LEADING events can carry a `nextSession` whose `user.id` is null
      // or undefined (initial storage resolution, mid-refresh state, etc.)
      // BEFORE the fully-resolved session event arrives milliseconds later.
      //
      // The previous code unconditionally called `setSession(null)` on
      // any event lacking a user id (lines 222-226 of the old version).
      // That flip-flop caused AuthGate to render <AuthScreen/> briefly,
      // FULLY UNMOUNTING the authenticated subtree (the open note editor!)
      // and then re-mounting it a moment later. The orphaned autosave timer
      // in the dying mount then fired across the boundary and wrote
      // `{ title: "...", body: "" }` to updateNote — wiping the note's
      // body while preserving its title. (Root cause confirmed by the
      // [MC-DBG] trace + WIPE-DETECTED stack from the diagnostic build.)
      //
      // FIX: session is now monotonic within a tab's lifetime. The ONLY
      // event that clears `session` is a genuine `SIGNED_OUT` (either
      // explicit via supabase.auth.signOut(), or the auth client emitting
      // SIGNED_OUT on storage sync from another tab). Every other event
      // — INITIAL_SESSION, TOKEN_REFRESHED, MFA_CHANGED, USER_UPDATED,
      // PASSWORD_RECOVERY, even an intermediate event with a null
      // `nextSession.user` — is treated as a NO-OP for auth-gate purposes:
      // the previously-known session stays put. Once you're in, you stay
      // in until you actually sign out.
      //
      // Diagnostic logging (still in place): every event is logged on the
      // console so the user can verify across 10+ tab cycles that no
      // spurious session-clear happens.

      console.log("[MC-DBG] auth.onAuthStateChange", {
        event,
        hasUser: Boolean(nextSession?.user?.id),
        userId: nextSession?.user?.id || "(none)",
        lastSyncedUserId: lastSyncedUserIdRef.current,
      });

      if (event === "SIGNED_OUT") {
        console.log("[MC-DBG] genuine SIGNED_OUT — clearing session");
        sessionRef.current = null;
        setSession(null);
        lastSyncedUserIdRef.current = null;
        clearActiveSyncUser();
        return;
      }

      const nextUserId = nextSession?.user?.id;
      if (!nextUserId) {
        // Intermediate / transient event during a token refresh — keep
        // the existing session. Previously this branch unmounted the whole
        // authenticated subtree. NO setSession(null) here.
        console.log("[MC-DBG] auth event with no user id — ignored (kept existing session)");
        return;
      }

      // STALE-CLOSURE FIX (second unmount path — the one the AuthGate fix
      // above did NOT close).
      //
      // This was `!session && nextSession`. Because this callback is
      // registered in a `[]`-deps effect, `session` is pinned to the
      // first-render value (null) for the lifetime of the subscription, so
      // `!session` was ALWAYS true and `userIdCleared` was ALWAYS true for
      // any event carrying a user id. Result: every TOKEN_REFRESHED /
      // INITIAL_SESSION / USER_UPDATED re-ran initializeSyncForUser, which
      // calls setSyncing(true) — and the `if (loading || syncing)` branch
      // below renders the "Syncing your MindCanvas..." screen INSTEAD of
      // `children`, fully unmounting FolderPage and the open note editor.
      //
      // That is the same unmount the monotonic-session fix was meant to
      // eliminate, reached by a different route: not a false sign-out, but
      // a false "you just logged in, resync everything". On tab return with
      // an aged access token it fires reliably.
      //
      // `sessionRef` carries the live value across the closure boundary.
      // Note `userIdChanged` already covers a genuine fresh login (the id
      // won't match lastSyncedUserIdRef), so this condition only needs to
      // catch "we had nothing and now we do".
      const userIdChanged = nextUserId !== lastSyncedUserIdRef.current;
      const userIdCleared = !sessionRef.current && nextSession;

      console.log("[MC-DBG] auth resync decision", {
        userIdChanged,
        userIdCleared,
        hadSession: Boolean(sessionRef.current),
        willResync: userIdChanged || userIdCleared,
      });

      sessionRef.current = nextSession;
      setSession(nextSession);
      setSyncError("");

      if (userIdChanged || userIdCleared) {
        lastSyncedUserIdRef.current = nextUserId;
        if (navigator.onLine) {
          setSyncing(true);
          try {
            await initializeSyncForUser(nextUserId);
          } catch (error) {
            console.error("Auth sync failed:", error);
            setSyncError("Some notes are local only. Sync will retry when online.");
          } finally {
            setSyncing(false);
          }
        } else {
          // Offline — skip sync, Dexie already has the cached data
          setSyncing(false);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (!configured) {
    return <ConfigMissing />;
  }

  if (loading || syncing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bone">
        <p className="font-sans text-warm-gray animate-pulse">
          {syncing ? "Syncing your MindCanvas..." : "Loading MindCanvas..."}
        </p>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <>
      {syncError && (
        <div className="fixed left-1/2 top-4 z-[80] -translate-x-1/2 rounded-full bg-ink px-4 py-2 font-sans text-xs text-bone shadow-lg">
          {syncError}
        </div>
      )}
      {/* 
        Route transitions are wrapped here (inside AuthGate, around children)
        rather than in layout.js so the swap between AuthScreen and the
        authenticated app doesn't itself animate — only in-app route changes do.
      */}
      <RouteTransition>{children}</RouteTransition>
    </>
  );
}
