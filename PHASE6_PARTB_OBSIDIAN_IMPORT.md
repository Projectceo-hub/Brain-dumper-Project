# MindCanvas — Phase 6, Part B: Obsidian Import + Notion Link Investigation

## Full project context (this agent session has NO prior context — read all of this before touching code)

You're working on **MindCanvas**, a brain-dump knowledge graph and notes app.
Solo founder, non-technical ("vibe coder") — explain what you're doing in
plain terms as you go. **Strict budget** — flag any new cost before adding
a paid service, API tier, or package.

**Stack:** Next.js App Router, Tailwind CSS, @xyflow/react (2D graph — do
not change this to a 3D library, out of scope), Dexie (local cache),
Supabase (Postgres source of truth + RLS + auth). Deployed on Vercel,
auto-deploys from GitHub (`Projectceo-hub/Brain-dumper-Project`) on push to
`main`.

**Already shipped (Phase 6, Part A):** Notion import — zip upload (handles
nested zip-in-zip), AI-proposed folder structure with a mandatory
propose-then-approve step (user must confirm before anything is written),
reusable helpers in `src/lib/notionImport.js`, `src/app/api/import-
organize/route.js`, `src/app/settings/import/page.js`. Read these files
first — this phase reuses the approval UI and AI-organize pattern, not
rebuild it.

**CRITICAL ARCHITECTURE CONSTRAINT (Phase 5b lesson): do NOT set `.style`
properties directly on `document.body`/`document.documentElement`/any DOM
node via JS. CSS classes/custom properties only.**

## Part 1: Obsidian import (the main task)

Obsidian vaults export differently from Notion — usually a **plain folder**
(not necessarily zipped), containing `.md` files directly, with:
- Obsidian's own folder structure (meaningful — often reflects the user's
  actual organizational intent, unlike Notion's export folders)
- No trailing hex ID in filenames (unlike Notion)
- A `.obsidian/` config folder that must be detected and skipped entirely
  — it contains app settings, not notes
- `[[wikilink]]` syntax inside note bodies — **leave this syntax intact,
  as literal text, in the imported note's content**. Do NOT attempt to
  resolve or convert wikilinks in this phase — that is separate,
  follow-up work (Phase 6 Part C), and depends on this phase preserving
  the raw `[[...]]` text correctly first.

Build the import flow:
- Accept either a `.zip` of a vault folder, or (if reasonably simple to
  support) a folder picker — use your judgment on what's simplest given
  the existing Phase 6 Part A file-upload pattern, but a `.zip` upload is
  an acceptable minimum if a folder picker adds real complexity.
- Parse the folder/file structure, skip `.obsidian/` and any other
  Obsidian-internal config folders/files (also skip `.trash/` if present)
- Preserve `.md` file content exactly as-is, including any `[[wikilinks]]`
  found in it — do not strip, alter, or attempt to parse these in this
  phase
- Reuse the exact same propose-then-approve UI flow and AI-organize
  pattern already built in Phase 6 Part A — do not duplicate this logic,
  import/reuse the existing components and API route pattern
- Show the same kind of upload summary ("Found X notes across Y folders")
  before proceeding to the AI proposal step, matching Part A's UX

## Part 2: Notion internal-link investigation (small, bounded, do this
separately — report findings, do NOT build anything based on this yet)

This is a short investigation task, not a build task. Report back clearly,
separately from Part 1's report:

1. Create a test page in Notion containing a `@`-mention/internal link to
   another Notion page (a "page mention"). Export that page (or its
   parent workspace/database) using Notion's own export feature, same as
   a real user would.
2. Open the exported `.md` file and report EXACTLY what that internal
   link looks like in the raw markdown — is it a plain link
   (`[Page Name](url-or-path)`), plain text with no link at all (the
   reference silently lost), a relative file path, or something else?
   Paste the exact raw text/syntax you find.
3. Do NOT write any code to parse or resolve this — this is purely a
   factual finding to inform a future phase (Phase 6 Part C, which will
   handle turning both Obsidian wikilinks AND whatever this Notion format
   turns out to be into real note-to-note connections in MindCanvas's
   data model).

If creating a fresh Notion test page isn't practical for any reason,
explain why and instead inspect one of the Notion exports already used in
Phase 6 Part A testing (if any file/example is still available) for any
trace of an internal link, and report what you find there instead.

## What NOT to do in this phase

- Don't attempt to resolve, parse, or convert `[[wikilinks]]` into real
  connections — preserve them as literal text only. That's Phase 6 Part C.
- Don't touch Notion import's existing logic (Part A) beyond what's needed
  for the small investigation in Part 2 — no code changes to Part A.
- Don't build any 3D graph rendering — out of scope, separate future phase.
- Don't add billing/premium-tier gating.
- Don't add any new paid API/package without flagging cost first.
- Don't use `.style.setProperty()` or inline style mutation via JS on
  `body`/`html`/any DOM node.

## Commit/push policy

**Do not commit or push anything without explicit confirmation from the
user first.**

## Verification before saying done

1. Upload a real Obsidian vault export (a folder/zip with at least 3-4
   notes, at least one containing a `[[wikilink]]`, and a `.obsidian/`
   folder present) — confirm the `.obsidian/` folder is correctly skipped
   and doesn't appear as an imported note.
2. Confirm the upload summary ("Found X notes...") is accurate.
3. Confirm the AI-proposed structure renders correctly (reusing Part A's
   UI) and can be approved.
4. After approval, open one of the imported notes and confirm its
   `[[wikilink]]` text is preserved exactly, character-for-character, in
   the note body — not stripped, not altered.
5. Separately, report the Part 2 investigation findings clearly, with the
   exact raw markdown snippet found for a Notion internal link.

Report back explicitly: what was built, how each step was tested, the
Part 2 investigation findings verbatim, any deviation and why, and
anything left unfinished or uncertain.
