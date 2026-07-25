# MindCanvas — Phase 6, Part A: Notion Import ("Magic Migration")

## Full project context (this agent session has NO prior context — read all of this before touching code)

You're working on **MindCanvas**, a brain-dump knowledge graph and notes app.
Solo founder, non-technical ("vibe coder") — explain what you're doing in
plain terms as you go, don't assume deep technical background. **Strict
£10/month total budget** — flag any new cost before adding a paid service,
API tier, or package.

**Stack already built and deployed:** Next.js App Router, Tailwind CSS,
@xyflow/react (graph rendering), Dexie (IndexedDB — local cache/offline
buffer, NOT the source of truth), Supabase (Postgres source of truth + Row
Level Security + email/password auth). Deployed on Vercel, auto-deploys from
GitHub (`Projectceo-hub/Brain-dumper-Project`) on push to `main`. Live at
brain-dumper-project.vercel.app.

**AI backend (already working, do not change the model or endpoint):**
NVIDIA NIM API, model `nvidia/nemotron-3-ultra-550b-a55b`, called from
`src/app/api/organize/route.js`. This existing route returns
`{ title, entities: [{name, type}], tree: {label, note, entityRefs,
children} }` with unlimited-depth nesting from a raw text dump. You will
likely need a **second, related route** for this phase (see Part 2 below) —
do not modify the existing `/api/organize` route's contract, since the
capsule/brain-dump flow depends on it unchanged.

**Design system (already implemented, do not redesign, match exactly):**
Warm bone `#F2EDE4` background, near-black ink `#1C1912` text, burnt
clay-orange `#C4571F` primary accent, deep pine green `#3D6B5C` secondary
accent. Fraunces (serif, headings) + Inter (sans, body/UI). A theme system
(`data-theme` attribute + CSS custom properties, `src/components/
ThemeProvider.jsx`) now exists with 5 themes — any new UI must work
correctly across all 5, not just the default.

**CRITICAL ARCHITECTURE CONSTRAINT (learned the hard way in Phase 5b): do
NOT add any JavaScript that directly sets `.style` properties on
`document.body`, `document.documentElement`, or any DOM node to force
visual updates. Theming and styling must go through CSS classes / CSS
custom properties only.** If something doesn't visually update when you
expect, the fix is to correct the CSS variable definition or its usage, not
to bypass CSS with direct DOM style mutation from JavaScript. State this
explicitly in your completion report: confirm you have not used
`.style.setProperty()` or inline style mutation via JS anywhere in this
phase's new code.

## What this phase is

**Import scope for this phase: Notion only.** Do not build Obsidian import
in this phase — that may be a separate future phase. Do not build any
partial/generic "any markdown source" abstraction unless it comes naturally
from clean code — the explicit target is Notion's export format specifically.

**The AI re-organization behavior is PROPOSE-THEN-APPROVE, not automatic.**
This is a deliberate, explicit requirement: after importing and having the AI
suggest a folder/note structure for the imported content, the user must see
a preview of the proposed structure and explicitly confirm before anything
is actually written into their MindCanvas account. Do not skip this step or
auto-apply the AI's suggested structure. This is different from the
existing brain-dump capsule flow (which does auto-apply) — import is a
higher-stakes, potentially-large-volume operation and needs a review gate.

## Part 1: Accept a Notion export upload

Notion exports as a `.zip` file containing nested folders of `.md` (or
`.html`, depending on export settings — support `.md` only for this phase,
that's Notion's more common/simpler export option) files, where each
file/folder name has a Notion-style suffix (a 32-character hex ID appended
to the title, e.g. `My Page 3f9a2e...html`). Sub-pages appear as nested
folders.

Build a file upload UI (a new route, e.g. `/settings/import` or similar —
use your judgment on the best placement given the existing Settings page
structure, but make it reachable from Settings) that:
- Accepts a single `.zip` file upload
- Unzips it (client-side or via an API route — your judgment on which is
  cleaner given the existing stack, but note we have no server-side
  persistent storage beyzond Supabase Postgres, so any temp file handling
  must be ephemeral/in-memory, not written to persistent disk)
- Parses the folder/file structure into a flat or nested list of
  `{ title, content, path }` objects, stripping the trailing Notion hex ID
  from titles so they display cleanly (e.g. "My Page 3f9a2e1b..." becomes
  "My Page")
- Shows the user a simple summary before doing anything else: "Found X
  pages across Y folders" — do not proceed to the AI step automatically,
  wait for the user to confirm they want to continue

## Part 2: AI-assisted re-organization proposal

Once the user confirms the import summary, send the parsed page list
(titles + a reasonable content excerpt per page — full content for
short pages, truncated for very long ones to manage token usage
responsibly given the free-tier rate limits) to a **new API route**
(e.g. `src/app/api/import-organize/route.js`) that calls the same NVIDIA
NIM backend already in use, with a system prompt asking it to propose:
- Which existing MindCanvas folders (if any) each imported page should go
  into, OR a new folder name if none of the existing ones fit
- Preserve Notion's existing nesting/hierarchy where meaningful (a Notion
  sub-page should likely become a child note or stay grouped with its
  parent's content, not get scattered)

Return this as strict JSON the frontend can render as a preview: something
like `{ proposedFolders: [{ name, isNew, pages: [{title, path}] }] }`.
Defensively normalize the AI's response in code (fallback values for
missing/malformed fields), since model output isn't 100% reliable — this
mirrors how the existing `/api/organize` route already handles AI response
normalization; look at that route's approach and follow the same pattern
for consistency.

## Part 3: Preview + approval UI

Render the proposed structure clearly: which folder each page will go into,
which folders are new vs. existing. Let the user:
- Approve as-is, which then actually creates the folders/notes (via the
  existing `createNote`/folder-creation helpers in `src/lib/db.js` — reuse
  these, don't duplicate note-creation logic)
- At minimum, allow the user to move a page from one proposed folder to
  another before approving (a simple dropdown/reassignment per page is
  enough for this phase — a full drag-and-drop re-org UI is not required,
  keep this simple)
- Cancel entirely, discarding the parsed import with no changes made to
  their account

Only after explicit approval should real folders/notes actually be created
in Supabase/Dexie.

## What NOT to do in this phase

- Don't build Obsidian import — Notion only, this phase.
- Don't auto-apply the AI's proposed structure without the approval step —
  this is a hard requirement, not a nice-to-have.
- Don't touch the existing `/api/organize` route's contract or system
  prompt — the brain-dump capsule flow depends on it staying exactly as-is.
- Don't add any new paid API, package, or service without flagging cost
  first — stay on NVIDIA NIM for the AI call.
- Don't add any billing/payment/premium-tier gating to this feature — it
  should work the same for all users right now; premium tiers are
  explicitly deferred to a later phase.
- Don't use `.style.setProperty()` or direct inline style mutation via JS
  on `body`/`html`/any DOM node — CSS classes and custom properties only.
- Don't touch the theme system, sidebar, graph views, or any other existing
  feature not directly required to build this import flow.

## Commit/push policy

**Do not commit or push anything without explicit confirmation from the
user first.** Work locally, report what's done, and wait for a clear
go-ahead before pushing to `main` (which auto-deploys to the live site).

## Verification before saying done

Manually test with a real small Notion export (a handful of pages, at least
one with a sub-page/nested structure) — not just a passing build:
1. Upload the zip, confirm the "Found X pages" summary is accurate.
2. Confirm the AI proposal renders with sensible folder groupings — sensible
   is subjective, but at minimum confirm no crashes, no malformed JSON
   breaking the UI, and folder names/page titles display cleanly (no
   leftover Notion hex IDs visible).
3. Reassign at least one page to a different folder in the preview, confirm
   the reassignment sticks before approving.
4. Approve, and confirm the folders/notes actually appear correctly in the
   normal MindCanvas dashboard and folder views afterward — open one of the
   imported notes and confirm its content came through correctly.
5. Try Cancel on a separate test run, and confirm nothing was written to the
   account.

Report back explicitly: what was built, how each of the 5 verification
steps above was actually tested (not just "build succeeded"), any deviation
from this spec and why, and anything left unfinished or uncertain — for
example, if large Notion exports (50+ pages) weren't tested, say so rather
than implying full coverage.
