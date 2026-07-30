# MindCanvas — Phase 6, Part C: @Mention System (Atomic Token, Build in Isolation First)

## Full project context (this agent session has NO prior context — read all of this before touching code)

You're working on **MindCanvas**, a brain-dump knowledge graph and notes app.
Solo founder, non-technical ("vibe coder") — explain what you're doing in
plain terms as you go. **Strict budget** — flag any new cost before adding
a paid service, API tier, or package.

**Stack:** Next.js App Router, Tailwind CSS, @xyflow/react (2D graph — do
NOT change this to a 3D library, out of scope), Dexie (local cache),
Supabase (Postgres source of truth + RLS + auth). Deployed on Vercel,
auto-deploys from GitHub (`Projectceo-hub/Brain-dumper-Project`) on push to
`main`.

**Already shipped (read these files before writing any code):**
- `src/lib/db.js` — Dexie schema and helpers
- `src/app/folder/[id]/page.js` — note editor (currently a plain
  `<textarea>` — this phase needs to change this, see below)
- `src/app/graph/page.js` — global graph and per-note graph views
- `src/lib/obsidianImport.js` — Obsidian import parser (preserves
  [[wikilinks]] as literal text currently — this phase converts them)

**CRITICAL ARCHITECTURE CONSTRAINTS:**
- Do NOT set `.style` properties directly on `document.body`,
  `document.documentElement`, or any DOM node via JS. CSS classes/custom
  properties only. (Phase 5b lesson.)
- Do NOT change the graph library from @xyflow/react.
- Do NOT add any paid service, API tier, or npm package without flagging
  cost and getting confirmation first.
- Do NOT commit or push anything without explicit confirmation from the
  user first.

## IMPORTANT — prior failed attempt at this exact feature

A previous attempt at this feature failed three rounds in a row using an
approach where the note body toggled between a raw `<textarea>` (editing)
and a separate rendered `<div>` (preview), with @mentions only becoming
clickable in the preview div. This caused: layout bugs (padding/bezels
appearing from the element swap), a scroll bug, a content-squishing bug,
and click-to-navigate never actually working. That whole attempt was
reverted. Do NOT repeat that approach.

## What the user actually wants (their words, plain)

Typing `@` and picking a note from a list should insert the mention as one
single unit — like Notion's `/` slash-command tokens. It should be
clickable to navigate immediately, without needing to click away or blur
first. Pressing backspace right after it should delete the whole mention
in one keystroke, not delete it letter by letter.

This requires converting the note editor from a plain `<textarea>` to a
`contenteditable` element, where an @mention is a real inline DOM element
(e.g. a `<span contenteditable="false">`) sitting inside the editable
area — this is the only way to get "one atomic clickable unit, one
backspace deletes it all" behavior. There is no simpler way to achieve
this exact behavior — do not propose a textarea-based alternative.

## MANDATORY: build and verify in total isolation first

Do NOT touch `src/app/folder/[id]/page.js` yet. Before integrating
anything into the real note editor, build this as a **standalone,
isolated test page** at a new route: `src/app/dev-mention-test/page.js`.

This isolated test page should contain:
- A single `contenteditable` div, styled minimally (no need to match app
  theme)
- Typing `@` triggers a simple dropdown showing a hardcoded list of 5 fake
  note names (no Supabase, no real data — just an array like
  `["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]`)
- Selecting one from the dropdown (click or arrow keys + Enter) inserts it
  as a `<span contenteditable="false" data-mention="NoteName">@NoteName</span>`
  inline at the cursor position
- The inserted span is clickable — clicking it should just `alert("would
  navigate to: " + noteName)` for now, no real routing yet
- Pressing backspace immediately after the span deletes the entire span
  in one keystroke, not character by character
- Typing normal text before, after, and around the span works normally —
  the rest of the contenteditable area behaves like a normal text field
- The user needs to be able to save/retrieve the content as plain text
  containing `@NoteName` syntax (so it can be stored the same way as
  before) — the contenteditable's HTML needs a serialize function that
  converts the DOM (including mention spans) back to plain `@NoteName`
  text, and a deserialize function that takes stored text and converts
  `@NoteName` occurrences back into real spans when loading

**Do not proceed past this point until the user has manually tested this
isolated page and confirmed all of the above works correctly.** Report
back with a summary of what to test and stop there — do not touch the
real note editor in this same session/response.

## What NOT to do in this phase

- Do NOT touch `src/app/folder/[id]/page.js` yet
- Do NOT connect to Supabase or the real note-picker data yet — hardcoded
  fake list only, at this stage
- Do NOT attempt the textarea-toggle approach that failed previously
- Do NOT add any new npm package (rich text editor library, etc.) without
  flagging cost/complexity first — try to build this with plain
  `contenteditable` and the browser Selection/Range APIs before reaching
  for a dependency
- Do NOT commit without explicit confirmation

## Report back

- Confirm the isolated test page is built at `/dev-mention-test`
- List exactly what the user should click/type to verify each behavior
  (typing @, selecting, clicking the mention, backspacing it, typing
  normal text around it, and reloading saved content)
- Do not claim this "works" — describe what you tested yourself and what
  still needs the user's manual confirmation
