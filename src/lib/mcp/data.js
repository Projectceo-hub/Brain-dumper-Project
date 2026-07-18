// User-scoped Supabase data access for the MCP server.
//
// All functions take an already-validated userId (resolved from an API token
// by resolveUserFromBearer) and use the service-role client. Every query
// explicitly filters by user_id so the RLS boundary is enforced at the
// application layer even though RLS itself is bypassed by the service role
// key (the service role is necessary because external MCP clients have no
// Supabase session of their own — they only have a Bearer token).
//
// SECURITY: never drop the `.eq("user_id", userId)` filter on these queries.

import { getServiceSupabase } from "@/lib/supabase/service";

function requireUserId(userId) {
  if (!userId || typeof userId !== "string") {
    throw new Error("Internal error: userId is required for MCP data access.");
  }
}

function rowToFolder(folder) {
  if (!folder) return null;
  return {
    id: folder.id,
    userId: folder.user_id,
    name: folder.name || "",
    createdAt: folder.created_at,
    updatedAt: folder.updated_at,
  };
}

function rowToNote(note) {
  if (!note) return null;
  return {
    id: note.id,
    userId: note.user_id,
    folderId: note.folder_id,
    parentNoteId: note.parent_note_id,
    title: note.title || "",
    body: note.body || "",
    createdAt: note.created_at,
    updatedAt: note.updated_at,
  };
}

export async function listFoldersForMcp(userId) {
  requireUserId(userId);
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Service role not configured.");

  const { data, error } = await supabase
    .from("folders")
    .select("id, user_id, name, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Failed to list folders: ${error.message}`);
  return (data || []).map(rowToFolder);
}

export async function getFolderByIdForMcp(userId, folderId) {
  requireUserId(userId);
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Service role not configured.");

  const { data, error } = await supabase
    .from("folders")
    .select("id, user_id, name, created_at, updated_at")
    .eq("user_id", userId)
    .eq("id", String(folderId))
    .maybeSingle();

  if (error) throw new Error(`Failed to get folder: ${error.message}`);
  return rowToFolder(data);
}

export async function getOrCreateFolderByNameForMcp(userId, name) {
  requireUserId(userId);
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Service role not configured.");

  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("Folder name is required.");

  const { data: existing, error: findErr } = await supabase
    .from("folders")
    .select("id, user_id, name, created_at, updated_at")
    .eq("user_id", userId)
    .ilike("name", trimmed)
    .maybeSingle();

  if (findErr) throw new Error(`Folder lookup failed: ${findErr.message}`);
  if (existing) return rowToFolder(existing);

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  const { data: inserted, error: insErr } = await supabase
    .from("folders")
    .insert({
      id: newId,
      user_id: userId,
      name: trimmed,
      created_at: now,
      updated_at: now,
    })
    .select("id, user_id, name, created_at, updated_at")
    .single();

  if (insErr) throw new Error(`Folder creation failed: ${insErr.message}`);
  return rowToFolder(inserted);
}

export async function listNotesForMcp(userId, opts = {}) {
  requireUserId(userId);
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Service role not configured.");

  let query = supabase
    .from("notes")
    .select(
      "id, user_id, folder_id, parent_note_id, title, body, created_at, updated_at",
    )
    .eq("user_id", userId)
    .is("parent_note_id", null)
    .order("updated_at", { ascending: false });

  if (opts.folderId) {
    query = query.eq("folder_id", String(opts.folderId));
  }
  if (opts.limit) {
    query = query.limit(Math.min(Number(opts.limit) || 20, 100));
  } else {
    query = query.limit(20);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list notes: ${error.message}`);
  return (data || []).map(rowToNote);
}

export async function getNoteByIdForMcp(userId, noteId) {
  requireUserId(userId);
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Service role not configured.");

  const { data, error } = await supabase
    .from("notes")
    .select(
      "id, user_id, folder_id, parent_note_id, title, body, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("id", String(noteId))
    .maybeSingle();

  if (error) throw new Error(`Failed to get note: ${error.message}`);
  return rowToNote(data);
}

export async function searchNotesForMcp(userId, queryText, opts = {}) {
  requireUserId(userId);
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Service role not configured.");

  const trimmed = (queryText || "").trim();
  if (!trimmed) return [];

  // Supabase Postgres ILIKE gives us case-insensitive substring search
  // across both title and body. Two OR-ed filters + user_id scoping.
  const { data, error } = await supabase
    .from("notes")
    .select(
      "id, user_id, folder_id, parent_note_id, title, body, created_at, updated_at",
    )
    .eq("user_id", userId)
    .is("parent_note_id", null)
    .or(
      `title.ilike.%${trimmed.replace(/[%,_]/g, (m) => "\\" + m)}%,body.ilike.%${trimmed.replace(/[%,_]/g, (m) => "\\" + m)}%`,
    )
    .order("updated_at", { ascending: false })
    .limit(Math.min(Number(opts.limit) || 20, 50));

  if (error) throw new Error(`Failed to search notes: ${error.message}`);
  return (data || []).map(rowToNote);
}

export async function createNoteForMcp(userId, opts) {
  requireUserId(userId);
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Service role not configured.");

  const title = (opts.title || "").toString();
  const body = (opts.body || "").toString();
  let folderId = opts.folderId ? String(opts.folderId) : "";

  if (!folderId && opts.folderName) {
    const folder = await getOrCreateFolderByNameForMcp(userId, opts.folderName);
    folderId = folder.id;
  }

  if (!folderId) {
    throw new Error(
      "create_note requires either folderId or folderName to identify the destination folder.",
    );
  }

  // Verify the folder belongs to this user before inserting into it.
  const owner = await getFolderByIdForMcp(userId, folderId);
  if (!owner) {
    throw new Error("Folder not found or does not belong to this user.");
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const resolvedTitle =
    title.trim() ||
    (body.trim()
      ? body.split("\n").find((line) => line.trim())?.trim().slice(0, 80) || "Untitled"
      : "Untitled");

  const { data, error } = await supabase
    .from("notes")
    .insert({
      id,
      user_id: userId,
      folder_id: folderId,
      parent_note_id: null,
      title: resolvedTitle,
      body: body.trim(),
      created_at: now,
      updated_at: now,
    })
    .select(
      "id, user_id, folder_id, parent_note_id, title, body, created_at, updated_at",
    )
    .single();

  if (error) throw new Error(`Failed to create note: ${error.message}`);

  // Bump folder's updated_at so it surfaces as recently active in the UI.
  await supabase
    .from("folders")
    .update({ updated_at: now })
    .eq("user_id", userId)
    .eq("id", folderId);

  return rowToNote(data);
}

export async function updateNoteForMcp(userId, noteId, changes) {
  requireUserId(userId);
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Service role not configured.");

  const existing = await getNoteByIdForMcp(userId, noteId);
  if (!existing) {
    throw new Error("Note not found or does not belong to this user.");
  }

  const next = {
    title: changes.title != null ? String(changes.title) : existing.title,
    body: changes.body != null ? String(changes.body) : existing.body,
  };
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("notes")
    .update({
      title: next.title,
      body: next.body,
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("id", String(noteId))
    .select(
      "id, user_id, folder_id, parent_note_id, title, body, created_at, updated_at",
    )
    .single();

  if (error) throw new Error(`Failed to update note: ${error.message}`);

  await supabase
    .from("folders")
    .update({ updated_at: now })
    .eq("user_id", userId)
    .eq("id", existing.folderId);

  return rowToNote(data);
}

/**
 * Create a child note for an AI-organized tree node. Used by the organize_dump
 * tool to mirror createNotesFromTree from db.js but server-side.
 */
export async function createChildNoteForMcp(
  userId,
  folderId,
  node,
  parentNoteId = null,
  saveEntitiesCallback,
) {
  requireUserId(userId);
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Service role not configured.");

  const label = (node.label || "").toString().trim() || "Untitled";
  const rawNoteBody = (node.note || "").toString();
  const entityRefs = Array.isArray(node.entityRefs) ? node.entityRefs : [];

  // Strip "User said:" / "The user said/mentioned/wrote:" narrative framing
  // the AI sometimes prepends despite the system prompt not asking for it —
  // mirrors the cleanNoteBody helper from db.js.
  let body = rawNoteBody.trim();
  body = body.replace(/^User said:?\s*/i, "");
  body = body.replace(/^The user (?:mentioned|said|noted|wrote):?\s*/i, "");
  if (body === label) body = "";

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const { data, error } = await supabase
    .from("notes")
    .insert({
      id,
      user_id: userId,
      folder_id: String(folderId),
      parent_note_id: parentNoteId == null ? null : String(parentNoteId),
      title: label,
      body,
      created_at: now,
      updated_at: now,
    })
    .select(
      "id, user_id, folder_id, parent_note_id, title, body, created_at, updated_at",
    )
    .single();

  if (error) throw new Error(`Failed to create child note: ${error.message}`);

  // Optional entity persistence (Phase 3 entity table) — best-effort, never
  // blocks a tool call from returning just because entity save failed.
  if (saveEntitiesCallback && entityRefs.length > 0) {
    try {
      await saveEntitiesCallback(userId, entityRefs, id);
    } catch (err) {
      console.warn("Entity save skipped:", err?.message || err);
    }
  }

  if (Array.isArray(node.children) && node.children.length > 0) {
    for (const child of node.children) {
      await createChildNoteForMcp(userId, folderId, child, id, saveEntitiesCallback);
    }
  }

  return rowToNote(data);
}

/**
 * Persist entities referenced by a tree into the Phase 3 entities table,
 * scoped to the owning user. Mirrors saveEntities from db.js, server-side.
 */
export async function saveEntitiesForMcp(userId, rawEntities, sourceNoteId = null) {
  requireUserId(userId);
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Service role not configured.");

  if (!Array.isArray(rawEntities) || rawEntities.length === 0) return [];

  // Fetch existing entities for this user to dedupe by (name, type).
  const { data: existing, error: fetchErr } = await supabase
    .from("entities")
    .select("id, user_id, name, type, source_note_id, created_at")
    .eq("user_id", userId);
  if (fetchErr) throw new Error(`Entity fetch failed: ${fetchErr.message}`);

  const out = [];
  for (const entity of rawEntities) {
    if (!entity?.name || !entity?.type) continue;
    const match = (existing || []).find(
      (row) => row.name === entity.name && row.type === entity.type,
    );
    if (match) {
      out.push(match);
      continue;
    }
    const id = crypto.randomUUID();
    const ins = {
      id,
      user_id: userId,
      name: entity.name,
      type: entity.type,
      source_note_id: sourceNoteId == null ? null : String(sourceNoteId),
      created_at: new Date().toISOString(),
    };
    const { data: inserted, error: insErr } = await supabase
      .from("entities")
      .insert(ins)
      .select("id, user_id, name, type, source_note_id, created_at")
      .single();
    if (insErr) {
      // Found a duplicate concurrent insert — refetch.
      const { data: refetched } = await supabase
        .from("entities")
        .select("id, user_id, name, type, source_note_id, created_at")
        .eq("user_id", userId)
        .eq("name", entity.name)
        .eq("type", entity.type)
        .maybeSingle();
      if (refetched) out.push(refetched);
      continue;
    }
    out.push(inserted);
    if (existing) existing.push(inserted);
  }
  return out;
}
