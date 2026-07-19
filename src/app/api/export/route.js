// POST /api/export
//
// Streams a ZIP file containing one folder-per-MindCanvas-folder, with each
// note as a `.md` file containing YAML frontmatter (title, folder, created,
// updated) followed by the note body. Designed to be Obsidian/standard
// Markdown compatible — no proprietary metadata, just frontmatter + body.
//
// Auth: requires a valid Supabase session cookie. Unauthenticated requests
// get 401, never data. The cookie-auth Supabase client is RLS-enforced, so
// even if a bug crept into the query layer, RLS would still prevent
// cross-user data leakage.
//
// Performance: two Supabase queries total (folders + notes), both RLS-scoped
// to the current user. No N+1 — notes are grouped in-memory by folder_id.

import { NextResponse } from "next/server";
import JSZip from "jszip";
import { getAuthenticatedUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Strip filesystem-unsafe characters and squash whitespace so the filename
// plays nicely across macOS/Windows/Linux. Spaces → hyphens, strip anything
// that's not [a-z0-9-_], truncate at 60 chars per the spec.
function sanitizeFilename(name) {
  const base = (name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "untitled").slice(0, 60);
}

// Same sanitisation but allow directory paths to keep their slashes —
// actually no, we want the folder name itself to be safe. Same rules.
function sanitizeFolderName(name) {
  return sanitizeFilename(name);
}

// Format a Date or ISO string as ISO 8601 for the YAML frontmatter.
function isoDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

// Escape a value for inclusion in a YAML flow scalar. We're writing simple
// strings; quotes are only needed if the string contains characters YAML
// would interpret (":", "#", leading "-", etc.). Easiest correct approach:
// wrap in double quotes and escape any internal double quotes + backslashes.
function yamlEscape(value) {
  if (value == null) return '""';
  const s = String(value);
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildMarkdownFile(note, folderName) {
  const title = note.title || "Untitled";
  const created = isoDate(note.created_at || note.createdAt);
  const updated = isoDate(note.updated_at || note.updatedAt);
  const body = note.body || "";

  const frontmatter = [
    "---",
    `title: ${yamlEscape(title)}`,
    `folder: ${yamlEscape(folderName || "")}`,
    `created: ${yamlEscape(created)}`,
    `updated: ${yamlEscape(updated)}`,
    "---",
    "",
  ].join("\n");

  return frontmatter + body + (body.endsWith("\n") ? "" : "\n");
}

function todayDateStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function POST() {
  try {
    const { supabase, user } = await getAuthenticatedUser();
    if (!supabase || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Two parallel queries — both RLS-scoped to the current user via the
    // cookie-auth client. Cheap and avoids N+1 client-side fetches.
    const [foldersResult, notesResult] = await Promise.all([
      supabase
        .from("folders")
        .select("id, name")
        .order("name", { ascending: true }),
      supabase
        .from("notes")
        .select("id, folder_id, title, body, created_at, updated_at")
        .order("created_at", { ascending: true }),
    ]);

    if (foldersResult.error) {
      console.error("Export folders query failed:", foldersResult.error);
      return NextResponse.json(
        { error: "Failed to fetch folders" },
        { status: 500 },
      );
    }
    if (notesResult.error) {
      console.error("Export notes query failed:", notesResult.error);
      return NextResponse.json(
        { error: "Failed to fetch notes" },
        { status: 500 },
      );
    }

    const folders = foldersResult.data || [];
    const notes = notesResult.data || [];

    const zip = new JSZip();

    // Map folder_id → { folderName, usedFilenames:Set } so we can dedupe
    // filenames inside each folder (e.g., two "Untitled" notes can't both
    // be Untitled.md — second one becomes Untitled-2.md).
    const folderStateById = new Map();
    for (const folder of folders) {
      const safeName = sanitizeFolderName(folder.name) || "untitled-folder";
      folderStateById.set(folder.id, {
        zipFolder: zip.folder(safeName),
        folderName: folder.name || "Untitled",
        usedFilenames: new Set(),
      });
    }

    // A bucket for notes whose folder_id is missing or doesn't belong to
    // the user (shouldn't happen under RLS, but defensive).
    const orphanBucket = {
      zipFolder: zip.folder("orphaned-notes"),
      folderName: "Orphaned notes",
      usedFilenames: new Set(),
    };

    for (const note of notes) {
      const state = folderStateById.get(note.folder_id) || orphanBucket;
      if (!state.zipFolder) continue;

      let base = sanitizeFilename(note.title) || "untitled";
      let filename = `${base}.md`;
      // Dedupe by appending -2, -3, etc. until unique within this folder.
      let n = 2;
      while (state.usedFilenames.has(filename)) {
        filename = `${base}-${n}.md`;
        n += 1;
      }
      state.usedFilenames.add(filename);

      const markdown = buildMarkdownFile(note, state.folderName);
      state.zipFolder.file(filename, markdown);
    }

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const filename = `mindcanvas-vault-${todayDateStamp()}.zip`;

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(zipBuffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}

// Also accept GET — same handler. Some users might click a download link
// rather than submit a form. The auth check is identical.
export async function GET() {
  return POST();
}
