// Phase 11 — global note search.
//
// POST /api/search
//   Body:    { query: string }
//   Returns: { results: Array<{ id, title, snippet, folder_name, folder_id }> }
//
// folder_id is not in the original spec but the caller needs it: opening a
// result routes to /folder/{folder_id}?note={id}, and there is no other way
// to resolve the folder from a note id on the client.

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";

const MIN_QUERY_CHARS = 2;
const RESULT_LIMIT = 20;
const SNIPPET_CHARS = 120;

// Same rule as the chat route's search tool: escape LIKE metacharacters so a
// query of "%" cannot match everything, and leave all other punctuation
// intact so titles containing commas or parentheses still match.
function toIlikePattern(value) {
  const escaped = String(value ?? "")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/[%_]/g, (ch) => `\\${ch}`);
  return escaped ? `%${escaped}%` : null;
}

// Mentions are stored inline as `@[id|title]`; show the title only.
const MENTION_TOKEN_RE = /@\[[^\]|]+\|([^\]]*)\]/g;

function toSnippet(bodyValue) {
  if (!bodyValue) return "";
  return String(bodyValue)
    .replace(MENTION_TOKEN_RE, "@$1")
    .slice(0, SNIPPET_CHARS);
}

export async function POST(request) {
  try {
    const { supabase, user } = await getAuthenticatedUser();
    if (!supabase || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (query.length < MIN_QUERY_CHARS) {
      return NextResponse.json({ results: [] });
    }

    const pattern = toIlikePattern(query);
    if (!pattern) return NextResponse.json({ results: [] });

    // Two single-column queries rather than one .or(): PostgREST parses an
    // .or() filter list on commas and parentheses, so a query containing
    // either would rewrite the filter instead of being matched literally.
    const [titleRes, bodyRes] = await Promise.all([
      supabase
        .from("notes")
        .select("id, title, body, folder_id, updated_at")
        .eq("user_id", user.id)
        .ilike("title", pattern)
        .order("updated_at", { ascending: false })
        .limit(RESULT_LIMIT),
      supabase
        .from("notes")
        .select("id, title, body, folder_id, updated_at")
        .eq("user_id", user.id)
        .ilike("body", pattern)
        .order("updated_at", { ascending: false })
        .limit(RESULT_LIMIT),
    ]);

    if (titleRes.error || bodyRes.error) {
      console.error("Search failed:", titleRes.error || bodyRes.error);
      return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }

    // Title matches rank above body-only matches; within each group the
    // query's own updated_at ordering already applies.
    const seen = new Set();
    const ordered = [];
    for (const note of [...(titleRes.data || []), ...(bodyRes.data || [])]) {
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      ordered.push(note);
      if (ordered.length >= RESULT_LIMIT) break;
    }

    // Folder names come from a separate lookup rather than an embedded
    // select, which would depend on PostgREST resolving the FK relationship.
    // The folder set is small enough that one extra query is cheaper than
    // that coupling.
    let folderNames = new Map();
    if (ordered.length > 0) {
      const { data: folders, error: foldersError } = await supabase
        .from("folders")
        .select("id, name")
        .eq("user_id", user.id);

      if (foldersError) {
        // Non-fatal: results are still useful without the folder badge.
        console.warn("Search folder lookup failed:", foldersError);
      } else {
        folderNames = new Map(
          (folders || []).map((f) => [String(f.id), f.name]),
        );
      }
    }

    const results = ordered.map((note) => ({
      id: note.id,
      title: note.title || "Untitled",
      snippet: toSnippet(note.body),
      folder_id: note.folder_id || null,
      folder_name: folderNames.get(String(note.folder_id)) || null,
    }));

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Internal Server Error in Search Route:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
