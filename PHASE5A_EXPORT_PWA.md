# MindCanvas — Phase 5a Build Prompt (Markdown Export + PWA Offline)

## Full context (assume zero prior memory — read all of this before touching code)

You're working on **MindCanvas**, a brain-dump notes + knowledge graph app.
Solo founder, non-technical ("vibe coder") — explain what you're doing in plain
terms, don't assume deep technical background. **Strict £10/month total budget**
— flag any new cost before adding a paid service, package, or tier.

**Stack:** Next.js App Router, Tailwind CSS, @xyflow/react (graph), Dexie
(IndexedDB — local cache/offline buffer), Supabase (Postgres + RLS, email/password
auth, real source of truth). Deployed on Vercel, auto-deploys from GitHub
(`Projectceo-hub/Brain-dumper-Project`) on push to `main`. Live at
brain-dumper-project.vercel.app.

**Design system (match exactly, do not invent new tokens):**
- Background: warm bone `#F2EDE4`
- Text/dark surfaces: near-black ink `#1C1912`
- Primary accent: burnt clay-orange `#C4571F`
- Secondary: deep pine green `#3D6B5C`
- Supporting: sage `#DCE4DC`, tan `#EDDFCB`
- Warm gray: `#8A8071` / `#6B6459` / `#A39A8A`
- Fonts: Fraunces (serif, headings) + Inter (sans, body/UI)

**Current routes:**
- `/` — Dashboard: asymmetric folder grid, sidebar, Dynamic Island capsule input
- `/folder/[id]` — Folder detail + inline note editor (autosave ~500ms debounce)
- `/graph` — Global + per-note graph (switched via `?note=` query param)
- `/settings/tokens` — API token management page

**Current sidebar contents (do not break):**
- App wordmark at top
- List of all folders with note counts
- "Second brain" link to `/graph`
- "+ New space" folder creation
- User email + logout button at bottom

**Key files:**
- `src/lib/db.js` — Dexie schema + Supabase sync layer. Contains all CRUD
  helpers. Read this before touching data operations.
- `src/app/page.js` — Dashboard + sidebar + capsule input
- `src/app/folder/[id]/page.js` — Folder detail + note editor
- `src/app/api/organize/route.js` — NVIDIA NIM AI organize (do not touch)
- `src/app/api/mcp/route.js` — MCP server (do not touch)
- `src/app/api/oauth/` — OAuth routes (do not touch)

---

## What this phase builds

Two independent features that solve the two biggest trust blockers for new users:
1. **Markdown export** — gives users a safe "escape hatch" so their data is never trapped
2. **PWA offline caching** — makes the app work without internet, turning it from a
   "web toy" into a reliable daily driver

These must be built independently — if one breaks, the other should still work.
Do Part A completely before starting Part B.

---

## Part A: Markdown Export ("Export Vault")

### What it does
A single button in the sidebar that downloads the user's entire MindCanvas vault
as a `.zip` file of standard Markdown files — one `.md` file per note, organised
into folders matching their MindCanvas folder structure.

### Exact output format
The zip should contain one folder per MindCanvas folder, named after the folder.
Each note becomes a `.md` file inside its folder, named after the note title
(sanitise the title for filesystem safety — strip special characters, replace
spaces with hyphens, truncate at 60 chars).

Each `.md` file should have this exact structure:
```
---
title: [note title]
folder: [folder name]
created: [ISO 8601 date]
updated: [ISO 8601 date]
---

[note body content]
```

If a note has no body, the body section is just empty — don't put placeholder
text. If a note title is empty, use "Untitled" as the filename and title.

### Where the button lives
In the existing sidebar, below the folder list and above the user email/logout
section. Style it to match the sidebar's existing aesthetic — bone-colored text,
subtle, not a big loud button. An icon (download arrow) + "Export vault" label.
Use the existing sidebar's font and spacing patterns — don't invent new styles.

### Implementation
- Build a new API route: `POST /api/export` 
- This route fetches all the user's folders and notes from Supabase (using the
  service role client so it's a single fast server-side query, not N+1 client
  calls), then builds the zip in memory and streams it back as a file download
- Use the `jszip` npm package to build the zip (check if it's already in
  `package.json` before installing — if not, install it and flag the addition)
- The route must be authenticated — verify the user's Supabase session from the
  request cookies before returning any data. An unauthenticated request must
  return 401, never data.
- The response headers must be:
  ```
  Content-Type: application/zip
  Content-Disposition: attachment; filename="mindcanvas-vault-[YYYY-MM-DD].zip"
  ```
  where the date is today's date

- The sidebar button calls this route via a simple `fetch()` and uses the
  browser's download API to trigger the file save. Show a loading state on the
  button while the export is generating ("Exporting..." with a spinner) and
  reset to normal after the download starts or if it errors.

### What NOT to do
- Do not stream notes one at a time — fetch all in one or two queries
- Do not expose other users' data — RLS must be enforced or the service role
  query must filter by `user_id` explicitly
- Do not add a settings page for this — the button lives in the sidebar only
- Do not change the zip format to anything other than standard `.md` files —
  the whole point is Obsidian/standard compatibility

---

## Part B: PWA Offline Caching

### What it does
Converts MindCanvas into a Progressive Web App (PWA) so that:
1. Users can install it to their phone's home screen (looks and feels like a
   native app, no browser chrome)
2. The app loads instantly from cache even with no internet connection
3. Notes typed while offline are saved locally to Dexie/IndexedDB and
   automatically sync to Supabase when the connection returns

### Important: Dexie is already the local cache
Phase 2 already built Dexie as a local cache that mirrors Supabase data. All
reads hit Dexie first, and writes go to Dexie immediately (optimistic) then
sync to Supabase in the background. This means the offline data layer is
**already mostly built**. Do not rewrite `db.js` or change the sync logic —
just make the app shell and assets available offline via a service worker.

### What to build

**1. Web App Manifest (`public/manifest.json`)**
```json
{
  "name": "MindCanvas",
  "short_name": "MindCanvas",
  "description": "Your second brain — capture, organise, visualise.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#F2EDE4",
  "theme_color": "#1C1912",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

Generate simple placeholder icons if real ones don't exist yet — a solid
`#1C1912` background with "MC" in Fraunces serif in `#C4571F` at 192×192 and
512×512. Use the `canvas` API in a build script or just create them with sharp/
jimp if available. Flag if icon generation needs a package install.

Add the manifest link to the root `layout.js`:
```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#1C1912" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="MindCanvas" />
<link rel="apple-touch-icon" href="/icon-192.png" />
```

**2. Service Worker (`public/sw.js`)**

Cache strategy: **Network-first with cache fallback** for all navigation and
API routes, **Cache-first** for static assets (JS, CSS, fonts, images).

The service worker must:
- On install: pre-cache the app shell (the main HTML, CSS, and JS chunks that
  Next.js generates) so the UI loads offline
- On fetch: for navigation requests (HTML pages), try network first, fall back
  to cached version if offline. For static assets, serve from cache first.
- For `/api/*` routes: do NOT cache these — let them fail naturally when
  offline (the UI handles this gracefully via Dexie's local data)
- Cache name: `mindcanvas-v1` — increment this version string whenever the
  service worker is updated to trigger cache invalidation

Register the service worker from a client component — create
`src/components/ServiceWorkerRegistrar.jsx` (a `'use client'` component that
calls `navigator.serviceWorker.register('/sw.js')` on mount) and include it
in the root layout.

**3. Offline state indicator**
Add a small, unobtrusive indicator in the sidebar (below the wordmark) that
shows when the user is offline. When offline:
- Show a small dot + "Offline — changes will sync when reconnected" in warm
  gray (`#8A8071`), small Inter font, below the wordmark
- When back online, this disappears automatically
- Use the browser's `navigator.onLine` and the `online`/`offline` window
  events to track this in a React state

**4. Offline write queue confirmation**
The existing Dexie sync already handles offline writes (from Phase 2). Verify
this actually works:
- While "offline" (disable network in Chrome DevTools), create a note via
  the capsule input
- Confirm it appears in the UI immediately (from Dexie)
- Re-enable network
- Confirm the note appears in Supabase within a few seconds

If the existing sync does NOT handle this correctly (i.e., failed Supabase
writes are silently dropped), fix it: wrap Supabase write calls in a try/catch
and if they fail due to network error, mark the Dexie record with a
`pendingSync: true` flag and retry on the next `online` event.

### What NOT to do
- Do not rewrite `db.js` or change the Supabase sync architecture
- Do not cache API responses in the service worker — Dexie already does this
- Do not use Workbox or any service worker library — write the service worker
  in plain JS. It's small enough not to need a framework and adding Workbox
  adds build complexity.
- Do not break the existing Supabase auth flow — the service worker must
  not intercept or modify auth cookie requests

---

## What NOT to do (global)

- Do not touch `/api/organize`, `/api/mcp`, or `/api/oauth/*` — these are
  working and out of scope
- Do not change the visual design system or introduce new colors/fonts
- Do not add any npm package without flagging it first (budget constraint).
  The only expected new package is `jszip` for Part A — everything else
  should be achievable without new dependencies
- Do not commit or push without explicit confirmation from the founder

---

## Verification checklist — do not call this done until all pass manually

**Part A — Export:**
1. Click "Export vault" in sidebar — confirm a `.zip` file downloads
2. Open the zip — confirm folder structure matches MindCanvas folders
3. Open a `.md` file — confirm YAML frontmatter is correct and body content
   matches the note
4. Open the app in an incognito window (not logged in), manually call
   `POST /api/export` — confirm it returns 401, not data

**Part B — PWA:**
1. Open the deployed site on a phone — confirm "Add to Home Screen" prompt
   appears (or is available via browser menu)
2. Install it and open from home screen — confirm it opens without browser
   chrome (full screen, no URL bar)
3. In Chrome DevTools → Network → set to "Offline"
4. Reload the page — confirm it loads from cache (not a browser error page)
5. Create a note while offline — confirm it appears in the UI immediately
6. Re-enable network — confirm the note syncs to Supabase within 10 seconds
7. Confirm the offline indicator appears in the sidebar when offline and
   disappears when back online

---

## Commit/push policy

Run `npm run build` first and confirm zero errors. Then report back exactly
what was built, what was tested, and what (if anything) wasn't finished.
Do not commit or push until the founder gives explicit go-ahead.
