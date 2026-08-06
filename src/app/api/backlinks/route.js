// Phase 11 — backlinks for a note.
//
// GET /api/backlinks?noteId=xxx
//   Returns: { backlinks: Array<{ id, title, snippet }> }
//
// Reads public.note_links, which stores "source_note_id mentions
// target_note_id" (see supabase/migrations/20260728_note_links.sql). Every
// failure mode returns an empty list rather than an error: backlinks are a
// supplementary panel and must never break the note editor.

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";

const SNIPPET_CHARS = 80;
const MAX_BACKLINKS = 50;

// Mentions are stored inline as `@[id|title]`; show the title only.
const MENTION_TOKEN_RE = /@\[[^\]|]+\|([^\]]*)\]/g;

const EMPTY = { backlinks: [] };

export async function GET(request) {
  try {
    const { supabase, user } = await getAuthenticatedUser();
    if (!supabase || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const noteId = request.nextUrl.searchParams.get("noteId");
    if (!noteId) return NextResponse.json(EMPTY);

    const { data: links, error: linksError } = await supabase
      .from("note_links")
      .select("source_note_id")
      .eq("target_note_id", noteId)
      .order("created_at", { ascending: false })
      .limit(MAX_BACKLINKS);

    if (linksError) {
      // Includes the case where the Part C migration was never applied.
      console.warn("Backlinks lookup failed:", linksError);
      return NextResponse.json(EMPTY);
    }

    const sourceIds = [
      ...new Set(
        (links || [])
          .map((l) => l.source_note_id)
          .filter(Boolean)
          .map(String),
      ),
    ];
    if (sourceIds.length === 0) return NextResponse.json(EMPTY);

    // user_id is pinned as well as relying on RLS, so a link row pointing at
    // someone else's note can never surface its title here.
    const { data: notes, error: notesError } = await supabase
      .from("notes")
      .select("id, title, body")
      .eq("user_id", user.id)
      .in("id", sourceIds);

    if (notesError) {
      console.warn("Backlinks note fetch failed:", notesError);
      return NextResponse.json(EMPTY);
    }

    // Preserve newest-link-first ordering from the note_links query.
    const byId = new Map((notes || []).map((n) => [String(n.id), n]));
    const backlinks = sourceIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((note) => ({
        id: note.id,
        title: note.title || "Untitled",
        snippet: (note.body || "")
          .replace(MENTION_TOKEN_RE, "@$1")
          .slice(0, SNIPPET_CHARS),
      }));

    return NextResponse.json({ backlinks });
  } catch (error) {
    console.error("Internal Server Error in Backlinks Route:", error);
    return NextResponse.json(EMPTY);
  }
}
