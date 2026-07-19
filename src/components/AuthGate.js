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

  useEffect(() => {
    if (!configured) {
      return;
    }

    const supabase = createClient();
    let mounted = true;

    async function loadSession() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      setSession(data.session ?? null);

      // Only run initial sync when we actually have a new user id. The
      // previous behaviour ran sync on every visibility-triggered getSession
      // call — this is what caused the "page reloads on tab return" symptom.
      const userId = data.session?.user?.id;
      if (userId && userId !== lastSyncedUserIdRef.current) {
        lastSyncedUserIdRef.current = userId;
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
      }

      setLoading(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      // Only update session state for genuine auth changes — NOT for
      // visibility/focus-triggered re-validation that Supabase does
      // internally. SIGNED_OUT is the only event that should clear state,
      // TOKEN_REFRESHED and INITIAL_SESSION keep the existing user but nextSession
      // may be a new session object (causing unnecessary re-renders).
      if (event === "SIGNED_OUT") {
        setSession(null);
        lastSyncedUserIdRef.current = null;
        clearActiveSyncUser();
        return;
      }

      // Only re-render + re-sync if the user id actually changed (e.g. sign-in
      // as a different user, or first sign-in after sign-out). This is what
      // prevents tab-refocus from re-syncing everything.
      const nextUserId = nextSession?.user?.id;
      if (!nextUserId) {
        setSession(null);
        return;
      }

      const userIdChanged = nextUserId !== lastSyncedUserIdRef.current;
      const userIdCleared = !session && nextSession;

      setSession(nextSession);
      setSyncError("");

      if (userIdChanged || userIdCleared) {
        lastSyncedUserIdRef.current = nextUserId;
        setSyncing(true);
        try {
          await initializeSyncForUser(nextUserId);
        } catch (error) {
          console.error("Auth sync failed:", error);
          setSyncError("Some notes are local only. Sync will retry when online.");
        } finally {
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
