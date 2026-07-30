-- Phase 6 Part C: note_links table.
--
-- Stores user-authored @mention connections between two notes. Each row
-- represents "source_note_id mentions target_note_id" — written when a
-- user picks a note from the @picker in the real editor (or when the
-- Obsidian-import post-step converts a matched [[wikilink]]).
--
-- `notes.id` in this project is TEXT (not UUID) — the notes table was
-- created with `id text primary key` and Dexie generates the ids as
-- crypto.randomUUID() strings. The default below preserves that shape
-- by casting gen_random_uuid() back to ::text so a row written directly
-- in the SQL Editor still fits the existing foreign key.
--
-- RLS guarantees a user can only link notes they own by checking the
-- source AND target notes' user_id against auth.uid().
--
-- This migration is idempotent: re-running it is safe.

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
