# MindCanvas — Phase Polish: Animations + Session Persistence

## Full context (assume zero prior memory — read all of this)

MindCanvas: brain-dump notes + knowledge graph app. Non-technical "vibe coder"
founder. Strict £10/month budget — flag any new cost before adding anything.

**Stack:** Next.js App Router, Tailwind CSS, @xyflow/react, Dexie (local cache),
Supabase (Postgres + RLS, email/password auth, real source of truth). Deployed on
Vercel, auto-deploys from GitHub (`Projectceo-hub/Brain-dumper-Project`) on push
to `main`. Live at brain-dumper-project.vercel.app.

**Design system (match exactly, do not invent new tokens):**
- Background: warm bone `#F2EDE4`
- Text/dark surfaces: near-black ink `#1C1912`
- Primary accent: burnt clay-orange `#C4571F`
- Secondary accent: deep pine green `#3D6B5C`
- Supporting: sage `#DCE4DC`, tan `#EDDFCB`
- Warm gray tones: `#8A8071` / `#6B6459` / `#A39A8A`
- Graph background: `#14110D`, graph lines: `#3A352C`
- Fonts: Fraunces (serif, headings) + Inter (sans, body/UI)

**Current routes:**
- `/` — Dashboard: asymmetric folder grid, Dynamic-Island capsule input, sidebar
- `/folder/[id]` — Folder detail + inline note editor
- `/graph` — Global + per-note graph (switched via `?note=` query param)
- `/settings/tokens` — API token management
- `/oauth/interact/[uid]` — OAuth consent page (do not touch)
- `/api/*` — Backend routes (do not touch any of these)

---

## Problem 1: White flash on every page navigation

Every route change produces a full white flash before the new page renders.
This makes the app feel like a basic website from 2010, not a polished product.

**Root cause:** Next.js App Router renders new pages with no transition — the
old page disappears instantly and the new page appears after a blank frame.

**What to build:** Apple-quality page transition system. The feel should be
smooth, fast, and intentional — like iOS app navigation, not a website reload.

### Specific animation requirements:

**Route transitions:**
- Outgoing page: fade out + very slight scale down (to ~0.98) over 120ms
- Incoming page: fade in + slight upward translate (from ~8px below) over
  180ms, with an ease-out curve
- The two should overlap slightly so there's never a blank frame between them
- Total perceived transition time: under 250ms — fast enough to feel instant,
  slow enough to feel smooth

**Folder cards on dashboard:**
- On page load, cards should stagger-animate in: each card fades in and
  rises from ~12px below, with each card delayed by 40ms after the previous
  one (hero card first, then medium cards, then small cards in order)
- On hover: subtle lift (translateY -2px) + very slight shadow increase,
  150ms ease-out
- On click/tap: quick scale down to 0.97 over 80ms before navigation begins
  (gives tactile "press" feedback)

**Note rows in folder view:**
- On load: same stagger-in as folder cards but faster (20ms between each row)
- On hover: left border accent appears (3px solid `#C4571F`), background
  shifts to slightly warmer tone, 120ms ease

**Capsule input:**
- Expand animation: spring physics feel — overshoot slightly past final size
  then settle, over ~200ms
- Options menu appearing above capsule: each option slides in from below with
  stagger (30ms between each), ease-out
- Collapse: quick fade + scale to pill shape, 150ms

**Sidebar:**
- On folder hover: background fill slides in from left, 100ms ease-out
- Active folder indicator (clay-orange left border): slides in, doesn't just
  appear

**Graph view:**
- Nodes on initial load: fade in with slight scale from 0.8 to 1.0, staggered
  by node index × 20ms, capped at 400ms total so large graphs don't take forever
- Side panel opening: slides in from right, 200ms ease-out

### Implementation approach:
- Use CSS custom properties and Tailwind's `transition` utilities where possible
- For the route transitions specifically, use Next.js App Router's layout system
  to wrap page content in an animation wrapper — the root `layout.js` should
  apply entry animations to its children on mount
- Do NOT add Framer Motion or any animation library — this is a budget-constrained
  project and the animations described above are achievable with CSS transitions
  and the Web Animations API. Flag if you genuinely cannot achieve something
  without a library before installing one.
- All animations must respect `prefers-reduced-motion` — wrap every animation
  in a media query check and skip or reduce to simple fade-only if the user
  has reduced motion enabled

---

## Problem 2: App reloads when returning from another tab

When the user leaves the MindCanvas tab (to copy a token, check something
elsewhere, etc.) and comes back, the page performs a full reload, losing any
in-progress state (typed text in capsule, open note editor content, etc.).

**Root cause:** The Supabase session handling is likely calling
`supabase.auth.getSession()` on every focus event or visibility change and
triggering a re-render/remount when it detects the page was hidden. Next.js
App Router may also be treating the page as stale and re-fetching server
components on tab focus.

**What to fix:**

1. **Supabase session persistence:** Ensure the Supabase client is initialized
   once and cached — do not create a new client instance on every render or
   route change. The `@supabase/ssr` browser client should be a singleton.
   Check `src/lib/supabase/` or wherever the client is initialized and confirm
   it uses a module-level singleton pattern, not a `new createClient()` call
   inside a component or hook body.

2. **Suppress visibility-triggered refetch:** Next.js App Router by default
   refetches server components when the window regains focus (via the router's
   `focus` event handler). Add this to `next.config.js` to disable it:
   ```js
   experimental: {
     staleTimes: {
       dynamic: 0,
     }
   }
   ```
   If that config key doesn't exist in this version of Next.js (16.x), find
   the equivalent way to prevent focus-triggered router refreshes — check
   current Next.js 16 docs before guessing.

3. **Preserve capsule input state across tab switches:** The capsule's typed
   text currently lives in React state and is lost on any remount. Store it in
   `sessionStorage` with a debounce — write to sessionStorage 300ms after the
   user stops typing, read from it on mount. Clear it after successful
   submission. This is specifically for the capsule textarea, not for note
   editor content (which already autosaves to Supabase).

4. **Preserve open note editor state:** If a user has a note open in the folder
   view and switches tabs, the editor should still show the same note when they
   return. This is likely already working if the URL contains the note ID — confirm
   the editor opens based on URL state or router params, not just local React
   state. If it's local React state only, move the "which note is open" tracking
   to a URL query param (`?note=[id]`) so it survives tab switches.

---

## What NOT to do

- Do NOT touch `/api/*` routes — none of these changes require backend work
- Do NOT touch the OAuth consent pages (`/oauth/interact/*`) — leave entirely
- Do NOT add Framer Motion, GSAP, or any other animation library without asking
- Do NOT change the design tokens, color palette, or font choices
- Do NOT change the Supabase auth method or table structure
- Do NOT add any new npm packages without flagging first (budget constraint)
- Do NOT break the existing capsule animation (the bounce/expand behavior that
  already works) — enhance it, don't replace it

---

## Verification — do not call this done until all of these pass manually:

1. Navigate between `/`, `/folder/[id]`, and `/graph` — confirm smooth fade
   transition with no white flash on any route change
2. Load the dashboard — confirm folder cards animate in with stagger, not all
   at once
3. Open a folder, hover over note rows — confirm hover state animates in
4. Open the capsule, type text, click outside — confirm spring-like expand and
   smooth collapse
5. Open MindCanvas, type something in the capsule, switch to another tab for
   10 seconds, come back — confirm the page has NOT reloaded and the typed
   text is still there
6. Open a note in the folder view, switch tabs, come back — confirm the same
   note is still open
7. Test on Chrome and Safari (both desktop and mobile if possible) — animations
   should work on both

---

## Commit/push policy

Do not commit or push without explicit confirmation from the founder. Run
`npm run build` first and confirm it passes with zero errors, then report
what was changed and wait for go-ahead.
