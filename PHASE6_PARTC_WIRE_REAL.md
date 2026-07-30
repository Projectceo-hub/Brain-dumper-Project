# MindCanvas — Phase 6, Part C: Wire @Mention Into Real Note Editor

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
- `src/app/folder/[id]/page.js` — real note editor (currently a plain
  `<textarea>` — this phase replaces it, see below)
- `src/app/dev-mention-test/page.js` — **a working, manually-verified
  isolated prototype** of the exact @mention interaction this phase needs.
  It uses a hardcoded fake list (Alpha/Beta/Gamma/Delta/Epsilon) and an
  `alert()` instead of real navigation. The user has personally tested and
  confirmed: typing `@` shows the picker, selecting inserts an atomic
  clickable mention span, clicking it fires the alert correctly, backspace
  deletes the whole mention in one keystroke (not character by character),
  normal typing around it works, and reload/save round-trips correctly.
  **This phase's job is to take that proven interaction pattern and
  connect it to real data — do not redesign the interaction, do not
  rebuild it from scratch, port the working contenteditable/span/
  serialize-deserialize logic from this file into the real editor.**
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

## IMPORTANT — history of this exact feature

An earlier attempt built @mentions directly in the real note editor using
a textarea/preview-div toggle approach. It failed three rounds in a row:
layout bugs (padding/bezels), a broken scroll, a content-squishing bug,
and click-to-navigate never working. That attempt was fully reverted via
`git reset --hard` back to the Phase 6 Part B commit.

The isolated prototype at `/dev-mention-test` was then built and manually
verified working, specifically to avoid repeating those failures. This
phase ports that proven pattern into the real editor — it does not
reinvent the interaction.

## Part 1: Supabase data model

Create a new `note_links` table. Notes' `id` column in this project is
**TEXT, not UUID** — confirm this yourself by checking the existing
`notes` table schema before writing the migration, do not assume UUID.

```sql
create table if not exists public.note_links (
  id              text primary key default gen_random_uuid()::text,
  source_note_id  text not null references public.notes(id) on delete cascade,
  target_note_id  text not null references public.notes(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (source_note_id, target_note_id)
);

create index if not exists note_links_source_idx
  on public.note_links (source_note_id);

create index if not exists note_links_target_idx
  on public.note_links (target_note_id);

alter table public.note_links enable row level security;

drop policy if exists "Users can manage their own note links"
  on public.note_links;

create policy "Users can manage their own note links"
  on public.note_links
  for all
  using (
    exists (
      select 1 from public.notes n
      where n.id = note_links.source_note_id
        and n.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.notes n
      where n.id = note_links.source_note_id
        and n.user_id = auth.uid()
    )
    and exists (
      select 1 from public.notes n
      where n.id = note_links.target_note_id
        and n.user_id = auth.uid()
    )
  );
```

Provide this SQL clearly at the end of your report so the user can run it
manually in Supabase's SQL Editor — do not assume it self-applies.

Add a matching Dexie table to `src/lib/db.js` as a local cache:
```js
note_links: 'id, source_note_id, target_note_id, created_at'
```

Add helpers to `db.js`:
- `createNoteLink(sourceNoteId, targetNoteId)` — writes to Dexie + syncs to Supabase
- `getNoteLinks(noteId)` — returns all links where noteId is source or target
- `deleteNoteLink(sourceNoteId, targetNoteId)` — removes from both

## Part 2: Port the proven mention component into the real editor

In `src/app/folder/[id]/page.js`:

- Replace the plain `<textarea>` with the contenteditable-based approach
  from `/dev-mention-test`, adapted to this file's existing note-loading,
  saving, and state-management logic
- The `@` picker's fake Alpha/Beta/Gamma/Delta/Epsilon list becomes a real
  query against the user's actual notes (and folders, if the existing app
  distinguishes mentioning a note vs. a folder — check current note/folder
  data structure first)
- On selecting a note from the picker: insert the atomic mention span (same
  behavior as the prototype) AND call `createNoteLink(currentNoteId,
  selectedNoteId)` so a real row is written
- If the user selects a folder rather than a note: insert the mention span
  for display only, do NOT write a note_link row (note_links is
  note-to-note only)
- Replace the prototype's `alert("would navigate to: ...")` with real
  navigation to the mentioned note, using whatever navigation pattern
  already exists elsewhere in this file (e.g. router.push to the note's
  actual route) — do not invent a new routing approach
- If a mentioned note has since been deleted, render that specific mention
  as plain non-clickable gray text instead of crashing or throwing

Do NOT touch layout, padding, or CSS beyond what's structurally required to
swap the textarea for the contenteditable component. Do not attempt to "improve"
anything else in this file while you're in it.

## Part 3: @mention conversion on Obsidian import

In `src/lib/obsidianImport.js`, after the AI-organize step has proposed
and the user has approved the import, add a post-processing step that:

1. Scans every imported note's body text for `[[wikilink]]` patterns
2. For each `[[Target Name]]` found:
   - Looks up whether an imported note with that exact title exists in the
     just-imported set (case-insensitive match)
   - If matched: replace `[[Target Name]]` with the real mention span
     format used by the editor, and call `createNoteLink(thisNoteId,
     matchedNoteId)`
   - If no match (dangling wikilink): replace with the mention span as
     display-only text, do NOT write a note_link row, do NOT crash
3. This step runs AFTER approval and AFTER notes are written to Supabase
4. Do NOT attempt to process Notion content in this step — Notion link
   resolution remains out of scope

## What NOT to do in this phase

- Do NOT invent a new interaction pattern for @mentions — port the proven
  one from `/dev-mention-test` exactly
- Do NOT attempt to resolve Notion internal links — out of scope
- Do NOT add graph view wiring for note_links — that is Phase 7, deliberately
  sequenced after this feature is confirmed working
- Do NOT change the graph library
- Do NOT touch layout/padding/CSS beyond the minimum required for the
  textarea-to-contenteditable swap
- Do NOT use `.style.setProperty()` or any inline JS DOM style mutation
- Do NOT commit or push without user confirmation
- Do NOT invent a different data model for storing connections — the
  note_links table above is required, not optional
- Do NOT delete or modify `/dev-mention-test` — leave it in place as a
  reference/fallback in case something needs to be re-checked in isolation

## Verification checklist (do all of these before saying done)

1. **Supabase migration**: confirm `note_links` table created with RLS.
   Provide exact SQL for the user to run manually.
2. **@mention typing in real editor**: open a real note, type `@` + a
   letter — confirm picker shows real matching notes, not the fake list.
3. **Atomic token behavior in real editor**: select a note — confirm it
   inserts as one clickable block, and one backspace deletes it entirely
   (not letter by letter) — same as the prototype.
4. **Real data write**: after selecting, check Supabase Table Editor →
   `note_links` — confirm a real row exists.
5. **Real navigation**: click the mention — confirm it navigates to the
   correct note's actual page (not an alert).
6. **Deleted-note handling**: delete a note that was mentioned elsewhere —
   confirm the mention becomes gray non-clickable text, no crash.
7. **Obsidian import conversion**: import the test vault — confirm
   `[[wikilinks]]` convert to real clickable mentions with note_link rows
   for matched targets, and display-only text for the dangling
   `[[This Note Does Not Exist]]` link.
8. **No regressions**: confirm existing note editing (typing, saving,
   loading, non-mention text) still works exactly as before. Confirm
   Notion import still works. Confirm no new layout/scroll/squish bugs
   were introduced — check this by opening several different notes of
   varying length, not just one.

## Report back

State explicitly, for each of the 8 verification steps above: pass or
fail, based on what you actually tested — not "build succeeded." List any
deviation from this spec and why. List anything left unfinished or
uncertain. Provide the exact SQL for the user to run in Supabase's SQL
Editor.
