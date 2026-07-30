/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Cache dynamic route segments in the Client Cache for 30s instead of
    // the default 0s. This is a general UX nicety that lets in-app
    // back/forward navigations re-use the last rendered shell instead of
    // re-rendering it (matters for routes like /graph and the folder list).
    //
    // HISTORY NOTE: This config was originally added (commit 60e527a)
    // to mitigate "white flash / app reloads when returning to the tab"
    // on the assumption that the App Router was refetching dynamic
    // segments on `visibilitychange`/`focus`. As of Next.js 16 there is
    // no App Router `visibilitychange` refetch in this project's
    // installed Next version — that was the real but different "tab
    // refocus" symptom from earlier Next releases.
    //
    // The actual tab-refocus data-loss bug (note body wiped, title
    // survives, intermittent) was caused by something entirely separate:
    // Supabase's auth client subscribes to `window.visibilitychange`
    // (see @supabase/auth-js GoTrueClient.js), and the previous AuthGate
    // flipped `session` to null on transient auth events that lacked a
    // user id. That flip-flop unmounted the entire authenticated subtree
    // — including the open note editor — and orphaned its autosave timer,
    // which then fired across the boundary and wrote `{ title, body: "" }`
    // to updateNote, wiping the body.
    //
    // The real fix lives in `src/components/AuthGate.js` (session is now
    // monotonic within a tab's lifetime; only a genuine `SIGNED_OUT`
    // event clears it) plus defense-in-depth in `src/app/folder/[id]/
    // page.js` (orphan timer cleared on unmount + a wipe-guard that
    // refuses to write an empty body unless the editor DOM is also
    // legitimately empty). This staleTimes config remains because it
    // is still good UX in general — it is NOT what fixes the wipe.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
