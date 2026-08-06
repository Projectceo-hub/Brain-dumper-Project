"use client";

import Dexie from "dexie";
import { createClient } from "@/lib/supabase/client";

const ACTIVE_USER_KEY = "mindcanvas.activeUserId";

// ---------------------------------------------------------------------------
// Local database
// ---------------------------------------------------------------------------
const db = new Dexie("MindCanvasDB");

db.version(1).stores({
  folders: "++id, name, createdAt, updatedAt",
  notes: "++id, folderId, parentNoteId, title, body, createdAt, updatedAt",
});

db.version(2).stores({
  folders: "id, userId, name, createdAt, updatedAt, syncStatus",
  notes:
    "id, userId, folderId, parentNoteId, title, body, createdAt, updatedAt, syncStatus",
  syncQueue:
    "++id, userId, table, recordId, action, createdAt, updatedAt, attempts",
  meta: "key",
});

db.version(3).stores({
  folders: "id, userId, name, createdAt, updatedAt, syncStatus",
  notes:
    "id, userId, folderId, parentNoteId, title, body, createdAt, updatedAt, syncStatus",
  syncQueue:
    "++id, userId, table, recordId, action, createdAt, updatedAt, attempts",
  meta: "key",
  entities: "id, userId, name, type, sourceNoteId, createdAt",
});

// Phase 6 Part C: note_links stores user-authored mention connections
// between two notes. Mirrors the remote public.note_links Supabase table
// (id TEXT, source_note_id TEXT, target_note_id TEXT, created_at).
db.version(4).stores({
  folders: "id, userId, name, createdAt, updatedAt, syncStatus",
  notes:
    "id, userId, folderId, parentNoteId, title, body, createdAt, updatedAt, syncStatus",
  syncQueue:
    "++id, userId, table, recordId, action, createdAt, updatedAt, attempts",
  meta: "key",
  entities: "id, userId, name, type, sourceNoteId, createdAt",
  note_links: "id, source_note_id, target_note_id, created_at",
});

// Phase 11: chat_history persists the "Ask your notes" thread across panel
// opens. A new store cannot be added to an already-installed version — every
// existing device is on v4 — so this is a +1 bump carrying v4's stores
// forward unchanged. Dexie migrates in place; no data is dropped.
//
// Local-only by design: there is no remote chat_history table and no
// syncQueue entry is written for it, so a thread never leaves the device.
db.version(5).stores({
  folders: "id, userId, name, createdAt, updatedAt, syncStatus",
  notes:
    "id, userId, folderId, parentNoteId, title, body, createdAt, updatedAt, syncStatus",
  syncQueue:
    "++id, userId, table, recordId, action, createdAt, updatedAt, attempts",
  meta: "key",
  entities: "id, userId, name, type, sourceNoteId, createdAt",
  note_links: "id, source_note_id, target_note_id, created_at",
  chat_history: "id",
});

export default db;

let activeUserId = null;

function getStoredUserId() {
  if (activeUserId) return activeUserId;
  if (typeof window === "undefined") return null;
  activeUserId = window.localStorage.getItem(ACTIVE_USER_KEY);
  return activeUserId;
}

function setStoredUserId(userId) {
  activeUserId = userId;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ACTIVE_USER_KEY, userId);
  }
}

export function clearActiveSyncUser() {
  activeUserId = null;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ACTIVE_USER_KEY);
  }
}

function getRequiredUserId() {
  const userId = getStoredUserId();
  if (!userId) {
    throw new Error("MindCanvas sync requires an authenticated user.");
  }
  return userId;
}

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toDate(value) {
  if (!value) return new Date();
  return value instanceof Date ? value : new Date(value);
}

function toRemoteFolder(folder) {
  return {
    id: String(folder.id),
    user_id: folder.userId,
    name: folder.name || "",
    created_at: toDate(folder.createdAt).toISOString(),
    updated_at: toDate(folder.updatedAt).toISOString(),
  };
}

function fromRemoteFolder(folder) {
  return {
    id: folder.id,
    userId: folder.user_id,
    name: folder.name || "",
    createdAt: toDate(folder.created_at),
    updatedAt: toDate(folder.updated_at),
    syncStatus: "synced",
    lastSyncError: "",
  };
}

function toRemoteNote(note) {
  return {
    id: String(note.id),
    user_id: note.userId,
    folder_id: String(note.folderId),
    parent_note_id: note.parentNoteId == null ? null : String(note.parentNoteId),
    title: note.title || "",
    body: note.body || "",
    created_at: toDate(note.createdAt).toISOString(),
    updated_at: toDate(note.updatedAt).toISOString(),
  };
}

function fromRemoteNote(note) {
  return {
    id: note.id,
    userId: note.user_id,
    folderId: note.folder_id,
    parentNoteId: note.parent_note_id,
    title: note.title || "",
    body: note.body || "",
    createdAt: toDate(note.created_at),
    updatedAt: toDate(note.updated_at),
    syncStatus: "synced",
    lastSyncError: "",
  };
}

async function queueSync({ table, recordId, action, payload }) {
  const userId = getRequiredUserId();
  await db.syncQueue.add({
    userId,
    table,
    recordId: String(recordId),
    action,
    payload,
    attempts: 0,
    lastError: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function markSynced(table, recordId) {
  const collection =
    table === "folders"
      ? db.folders
      : table === "note_links"
        ? db.note_links
        : db.notes;
  await collection.update(String(recordId), {
    syncStatus: "synced",
    lastSyncError: "",
  });
}

async function markSyncFailed(table, recordId, error) {
  const collection =
    table === "folders"
      ? db.folders
      : table === "note_links"
        ? db.note_links
        : db.notes;
  await collection.update(String(recordId), {
    syncStatus: "pending",
    lastSyncError: error?.message || "Sync failed",
  });
}

async function pushChange(change) {
  const supabase = createClient();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  if (change.table === "folders") {
    if (change.action === "delete") {
      const { error } = await supabase
        .from("folders")
        .delete()
        .eq("id", change.recordId);
      if (error) throw error;
      return;
    }

    const { error } = await supabase
      .from("folders")
      .upsert(change.payload, { onConflict: "id" });
    if (error) throw error;
    return;
  }

  if (change.table === "note_links") {
    if (change.action === "delete") {
      const { error } = await supabase
        .from("note_links")
        .delete()
        .eq("id", change.recordId);
      if (error) throw error;
      return;
    }
    const { error } = await supabase
      .from("note_links")
      .upsert(change.payload, { onConflict: "id" });
    if (error) throw error;
    return;
  }

  if (change.action === "delete") {
    const { error } = await supabase
      .from("notes")
      .delete()
      .eq("id", change.recordId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("notes")
    .upsert(change.payload, { onConflict: "id" });
  if (error) throw error;
}

async function syncOrQueue(change) {
  try {
    await pushChange(change);
    if (change.action !== "delete") {
      await markSynced(change.table, change.recordId);
    }
  } catch (error) {
    await queueSync(change);
    if (change.action !== "delete") {
      await markSyncFailed(change.table, change.recordId, error);
    }
    console.warn("Queued failed sync:", error);
  }
}

export async function retryPendingSync() {
  const userId = getStoredUserId();
  if (!userId) return;

  const pending = await db.syncQueue.where("userId").equals(userId).toArray();
  pending.sort((a, b) => toDate(a.createdAt) - toDate(b.createdAt));

  for (const item of pending) {
    try {
      await pushChange(item);
      await db.syncQueue.delete(item.id);
      if (item.action !== "delete") {
        await markSynced(item.table, item.recordId);
      }
    } catch (error) {
      await db.syncQueue.update(item.id, {
        attempts: (item.attempts || 0) + 1,
        lastError: error?.message || "Sync failed",
        updatedAt: new Date(),
      });
      break;
    }
  }
}

async function adoptLegacyLocalRows(userId) {
  const [legacyFolders, legacyNotes] = await Promise.all([
    db.folders.filter((folder) => !folder.userId).toArray(),
    db.notes.filter((note) => !note.userId).toArray(),
  ]);

  if (legacyFolders.length === 0 && legacyNotes.length === 0) {
    return;
  }

  for (const folder of legacyFolders) {
    const updated = {
      ...folder,
      id: String(folder.id),
      userId,
      syncStatus: "pending",
    };
    await db.folders.delete(folder.id);
    await db.folders.put(updated);
    await queueSync({
      table: "folders",
      recordId: updated.id,
      action: "upsert",
      payload: toRemoteFolder(updated),
    });
  }

  for (const note of legacyNotes) {
    const updated = {
      ...note,
      id: String(note.id),
      userId,
      folderId: String(note.folderId),
      parentNoteId: note.parentNoteId == null ? null : String(note.parentNoteId),
      syncStatus: "pending",
    };
    await db.notes.delete(note.id);
    await db.notes.put(updated);
    await queueSync({
      table: "notes",
      recordId: updated.id,
      action: "upsert",
      payload: toRemoteNote(updated),
    });
  }
}

async function mergeRemoteRows(userId, remoteFolders, remoteNotes) {
  const pending = await db.syncQueue.where("userId").equals(userId).toArray();
  const pendingKeys = new Set(
    pending.map((item) => `${item.table}:${String(item.recordId)}`)
  );

  for (const folder of remoteFolders) {
    if (!pendingKeys.has(`folders:${folder.id}`)) {
      await db.folders.put(fromRemoteFolder(folder));
    }
  }

  for (const note of remoteNotes) {
    if (!pendingKeys.has(`notes:${note.id}`)) {
      await db.notes.put(fromRemoteNote(note));
    }
  }

  const remoteFolderIds = new Set(remoteFolders.map((folder) => folder.id));
  const remoteNoteIds = new Set(remoteNotes.map((note) => note.id));

  const localFolders = await db.folders.where("userId").equals(userId).toArray();
  const localNotes = await db.notes.where("userId").equals(userId).toArray();

  for (const folder of localFolders) {
    const key = `folders:${String(folder.id)}`;
    if (
      folder.syncStatus === "synced" &&
      !remoteFolderIds.has(String(folder.id)) &&
      !pendingKeys.has(key)
    ) {
      await db.folders.delete(folder.id);
    }
  }

  for (const note of localNotes) {
    const key = `notes:${String(note.id)}`;
    if (
      note.syncStatus === "synced" &&
      !remoteNoteIds.has(String(note.id)) &&
      !pendingKeys.has(key)
    ) {
      await db.notes.delete(note.id);
    }
  }
}

export async function initializeSyncForUser(userId) {
  setStoredUserId(userId);
  await db.meta.put({ key: "activeUserId", value: userId });
  await adoptLegacyLocalRows(userId);

  const supabase = createClient();
  if (!supabase) return;

  const [foldersResult, notesResult, linksResult] = await Promise.all([
    supabase.from("folders").select("*").order("updated_at", { ascending: false }),
    supabase.from("notes").select("*").order("updated_at", { ascending: false }),
    supabase.from("note_links").select("*").order("created_at", { ascending: false }),
  ]);

  if (foldersResult.error) throw foldersResult.error;
  if (notesResult.error) throw notesResult.error;
  // note_links may not exist yet for users who haven't run the Part C
  // migration — treat that specific error as "no remote links yet" rather
  // than failing the whole sync. Any other error still throws.
  if (linksResult.error) {
    const msg = (linksResult.error && linksResult.error.message) || "";
    if (!/relation .*note_links/i.test(msg)) throw linksResult.error;
  }

  await mergeRemoteRows(userId, foldersResult.data || [], notesResult.data || []);
  await mergeRemoteNoteLinks(userId, linksResult.data || []);
  await retryPendingSync();

  if (typeof window !== "undefined") {
    window.removeEventListener("online", retryPendingSync);
    window.addEventListener("online", retryPendingSync);
  }
}

async function userFoldersCollection() {
  const userId = getRequiredUserId();
  return db.folders.where("userId").equals(userId);
}

async function userNotesCollection() {
  const userId = getRequiredUserId();
  return db.notes.where("userId").equals(userId);
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function hasAnyFolders() {
  const folders = await userFoldersCollection();
  const count = await folders.count();
  return count > 0;
}

export async function getFoldersForDashboard() {
  const folders = await userFoldersCollection();
  const folderList = await folders.toArray();
  folderList.sort((a, b) => toDate(b.updatedAt) - toDate(a.updatedAt));

  return folderList.map((folder, i) => {
    let size = "default";
    if (i === 0) size = "hero";
    else if (i === 1) size = "med";
    else if (i === 2) size = "tan";
    return { ...folder, size };
  });
}

export async function getAllFolders() {
  const folders = await userFoldersCollection();
  const folderList = await folders.toArray();
  return folderList.sort((a, b) => a.name.localeCompare(b.name));
}

export const QUICK_NOTES_FOLDER_NAME = "Quick notes";

export async function getOrCreateQuickNotesFolder() {
  const folders = await userFoldersCollection();
  const folderList = await folders.toArray();
  const existing = folderList.find((f) => f.name === QUICK_NOTES_FOLDER_NAME);
  if (existing) return existing.id;
  return createFolder(QUICK_NOTES_FOLDER_NAME);
}

export async function createFolder(name) {
  const now = new Date();
  const userId = getRequiredUserId();
  const folder = {
    id: makeId(),
    userId,
    name,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
    lastSyncError: "",
  };

  await db.folders.add(folder);
  await syncOrQueue({
    table: "folders",
    recordId: folder.id,
    action: "upsert",
    payload: toRemoteFolder(folder),
  });

  return folder.id;
}

export async function getFolderById(id) {
  const folder = await db.folders.get(String(id));
  const userId = getRequiredUserId();
  return folder?.userId === userId ? folder : undefined;
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

const SEED_PROFILES = {
  work: ["Projects", "Meetings", "Ideas"],
  personal: ["Journal", "Goals", "Inspiration"],
  study: ["Courses", "Research", "Reading List"],
};

export async function seedFoldersForProfile(profile) {
  const names = SEED_PROFILES[profile] || SEED_PROFILES.work;
  const now = new Date();
  const userId = getRequiredUserId();

  const folders = names.map((name, i) => ({
    id: makeId(),
    userId,
    name,
    createdAt: now,
    updatedAt: new Date(now.getTime() - i * 1000),
    syncStatus: "pending",
    lastSyncError: "",
  }));

  await db.folders.bulkAdd(folders);

  for (const folder of folders) {
    await syncOrQueue({
      table: "folders",
      recordId: folder.id,
      action: "upsert",
      payload: toRemoteFolder(folder),
    });
  }
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function getNotesInFolder(folderId) {
  const notes = await userNotesCollection();
  const noteList = await notes
    .filter((note) => String(note.folderId) === String(folderId))
    .toArray();

  return noteList
    .filter((note) => note.parentNoteId === null || note.parentNoteId === undefined)
    .sort((a, b) => toDate(b.updatedAt) - toDate(a.updatedAt));
}

function cleanNoteBody(note, label) {
  if (!note || typeof note !== "string") return "";
  let body = note.trim();
  body = body.replace(/^User said:?\s*/i, "");
  body = body.replace(/^The user (?:mentioned|said|noted|wrote):?\s*/i, "");
  if (label && body === label.trim()) return "";
  return body;
}

function titleFromBody(body) {
  const firstLine = body.split("\n").find((line) => line.trim());
  if (!firstLine) return "";
  return firstLine.trim().slice(0, 80);
}

export async function createNote(folderId, title = "", body = "") {
  const now = new Date();
  const userId = getRequiredUserId();
  const cleanedBody = typeof body === "string" ? body.trim() : "";
  const resolvedTitle =
    typeof title === "string" && title.trim()
      ? title.trim()
      : titleFromBody(cleanedBody);

  const note = {
    id: makeId(),
    userId,
    folderId: String(folderId),
    parentNoteId: null,
    title: resolvedTitle,
    body: cleanedBody,
    entityRefs: [],
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
    lastSyncError: "",
  };

  await db.notes.add(note);
  await touchFolder(folderId, now);

  await syncOrQueue({
    table: "notes",
    recordId: note.id,
    action: "upsert",
    payload: toRemoteNote(note),
  });

  return note.id;
}

async function touchFolder(folderId, updatedAt = new Date()) {
  const folder = await getFolderById(folderId);
  if (!folder) return;

  const updated = {
    ...folder,
    updatedAt,
    syncStatus: "pending",
  };

  await db.folders.put(updated);
  await syncOrQueue({
    table: "folders",
    recordId: updated.id,
    action: "upsert",
    payload: toRemoteFolder(updated),
  });
}

export async function updateNote(noteId, changes) {
  const now = new Date();
  const note = await getNoteById(noteId);
  if (!note) return;

  const updated = {
    ...note,
    ...changes,
    updatedAt: now,
    syncStatus: "pending",
  };

  // Diagnostic: detect the "body wiped but title survives" signature and
  // log a stack trace so we can find the caller. Without a stack trace
  // logging here, we won't know who triggered the empty write.
  const prevBodyLen = (note.body || "").length;
  const nextBodyLen = (updated.body || "").length;
  const bodyWiped = prevBodyLen > 0 && nextBodyLen === 0;
  if (bodyWiped) {
    console.warn(
      "[MC-DBG] updateNote WIPE-DETECTED",
      {
        noteId,
        prevBodyLen,
        nextBodyLen,
        prevTitle: note.title,
        nextTitle: updated.title,
        bodyInChanges: changes && "body" in changes,
        titleInChanges: changes && "title" in changes,
      },
      new Error("wipe-stack"),
    );
  }

  await db.notes.put(updated);
  await touchFolder(updated.folderId, now);

  await syncOrQueue({
    table: "notes",
    recordId: updated.id,
    action: "upsert",
    payload: toRemoteNote(updated),
  });
}

export async function deleteNote(noteId) {
  const note = await getNoteById(noteId);
  if (!note) return;

  await db.notes
    .where("parentNoteId")
    .equals(String(noteId))
    .delete();
  await db.notes.delete(String(noteId));
  await touchFolder(note.folderId, new Date());

  await syncOrQueue({
    table: "notes",
    recordId: String(noteId),
    action: "delete",
    payload: { id: String(noteId), user_id: note.userId },
  });
}

// ---------------------------------------------------------------------------
// Note links (Phase 6 Part C — @mention connections between two notes)
// ---------------------------------------------------------------------------
// `note_links` mirrors the remote public.note_links table. RLS on the
// remote side guarantees a user can only link their own notes — we replicate
// that check locally by resolving both endpoints through getNoteById before
// writing, so a stale local cache can never produce a link between notes the
// user doesn't own. The unique (source_note_id, target_note_id) constraint
// is enforced both locally (we delete-then-add) and remotely (the unique
// index on the Supabase table).

function toRemoteNoteLink(link) {
  return {
    id: String(link.id),
    source_note_id: String(link.source_note_id),
    target_note_id: String(link.target_note_id),
    created_at: toDate(link.created_at).toISOString(),
  };
}

function fromRemoteNoteLink(link) {
  return {
    id: link.id,
    source_note_id: link.source_note_id,
    target_note_id: link.target_note_id,
    created_at: toDate(link.created_at),
    syncStatus: "synced",
    lastSyncError: "",
  };
}

// Creates a directed note_link: "sourceNoteId mentions targetNoteId".
// Idempotent — if the same (source, target) pair already exists locally or
// remotely, no duplicate row is created. Returns the link id (existing or
// new), or null if either note can't be resolved (no silent fake writes).
export async function createNoteLink(sourceNoteId, targetNoteId) {
  if (!sourceNoteId || !targetNoteId) return null;
  if (String(sourceNoteId) === String(targetNoteId)) return null;

  const [source, target] = await Promise.all([
    getNoteById(sourceNoteId),
    getNoteById(targetNoteId),
  ]);
  if (!source || !target) return null;

  const srcId = String(sourceNoteId);
  const tgtId = String(targetNoteId);

  // Idempotent: if a local row already exists for this pair, reuse it.
  const existing = await db.note_links
    .where("source_note_id")
    .equals(srcId)
    .and((row) => String(row.target_note_id) === tgtId)
    .first();
  if (existing) return existing.id;

  const link = {
    id: makeId(),
    source_note_id: srcId,
    target_note_id: tgtId,
    created_at: new Date(),
    syncStatus: "pending",
    lastSyncError: "",
  };

  await db.note_links.add(link);
  await syncOrQueue({
    table: "note_links",
    recordId: link.id,
    action: "upsert",
    payload: toRemoteNoteLink(link),
  });

  return link.id;
}

// Returns every note_link row where noteId is either the source or the
// target. Used by the editor to render mention spans whose target still
// exists, and to gray-out mentions whose target has been deleted.
export async function getNoteLinks(noteId) {
  if (!noteId) return [];
  const id = String(noteId);

  const [asSource, asTarget] = await Promise.all([
    db.note_links.where("source_note_id").equals(id).toArray(),
    db.note_links.where("target_note_id").equals(id).toArray(),
  ]);

  // Dedup by id in case the same row shows up in both indexes (shouldn't,
  // since source != target, but defensive).
  const seen = new Set();
  const out = [];
  for (const row of [...asSource, ...asTarget]) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

// Phase 7A: bulk read of every locally-cached note_link row, for the graph
// view. The Dexie note_links store carries no userId column, so callers
// must scope results themselves — the graph does this by dropping any link
// whose endpoints aren't both present in its (already user-scoped) node set.
export async function getAllNoteLinks() {
  return db.note_links.toArray();
}

// Removes a specific (source -> target) link from both Dexie and Supabase.
export async function deleteNoteLink(sourceNoteId, targetNoteId) {
  if (!sourceNoteId || !targetNoteId) return;
  const srcId = String(sourceNoteId);
  const tgtId = String(targetNoteId);

  const existing = await db.note_links
    .where("source_note_id")
    .equals(srcId)
    .and((row) => String(row.target_note_id) === tgtId)
    .toArray();

  for (const row of existing) {
    await db.note_links.delete(row.id);
    await syncOrQueue({
      table: "note_links",
      recordId: row.id,
      action: "delete",
      payload: { id: row.id },
    });
  }
}

// Used by initializeSyncForUser to pull remote note_links into the local
// cache after a login, mirroring what mergeRemoteRows does for folders and
// notes. Kept local to this module (not exported) because the public API is
// the three functions above.
async function mergeRemoteNoteLinks(userId, remoteLinks) {
  for (const link of remoteLinks) {
    await db.note_links.put(fromRemoteNoteLink(link));
  }
}

// ---------------------------------------------------------------------------
// Chat history (Phase 11 — persisted "Ask your notes" thread)
// ---------------------------------------------------------------------------
// One row, keyed "global", holding the last CHAT_HISTORY_LIMIT messages.
// Every helper swallows its own errors: a chat panel must never fail to open
// because IndexedDB is unavailable (private browsing, quota, blocked origin).

const CHAT_HISTORY_KEY = "global";
const CHAT_HISTORY_LIMIT = 50;

export async function getChatHistory() {
  try {
    const row = await db.chat_history.get(CHAT_HISTORY_KEY);
    if (!row || !Array.isArray(row.messages)) return [];
    return row.messages.slice(-CHAT_HISTORY_LIMIT);
  } catch (err) {
    console.warn("Could not read chat history:", err);
    return [];
  }
}

export async function saveChatHistory(messages) {
  try {
    await db.chat_history.put({
      id: CHAT_HISTORY_KEY,
      messages: (messages || []).slice(-CHAT_HISTORY_LIMIT),
      updatedAt: new Date(),
    });
  } catch (err) {
    console.warn("Could not save chat history:", err);
  }
}

export async function clearChatHistory() {
  try {
    await db.chat_history.delete(CHAT_HISTORY_KEY);
  } catch (err) {
    console.warn("Could not clear chat history:", err);
  }
}

// Backlinks read straight from the local mirror so they work offline and
// reflect a link the moment it is created, before it has synced. Returns
// notes that link TO noteId, newest link first.
export async function getBacklinks(noteId) {
  if (!noteId) return [];
  const id = String(noteId);

  const links = await db.note_links.where("target_note_id").equals(id).toArray();
  links.sort((a, b) => toDate(b.created_at) - toDate(a.created_at));

  const seen = new Set();
  const out = [];
  for (const link of links) {
    const sourceId = String(link.source_note_id);
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    // getNoteById enforces the userId check, so a stale local row can never
    // surface another user's note.
    const note = await getNoteById(sourceId);
    if (!note) continue;
    out.push({
      id: note.id,
      title: note.title || "Untitled",
      snippet: (note.body || "").replace(MENTION_TOKEN_RE, "@$1").slice(0, 80),
    });
  }
  return out;
}

// Mentions are stored inline as `@[id|title]`; show the title only.
const MENTION_TOKEN_RE = /@\[[^\]|]+\|([^\]]*)\]/g;

export async function getNoteById(noteId) {
  const note = await db.notes.get(String(noteId));
  const userId = getRequiredUserId();
  return note?.userId === userId ? note : undefined;
}

export async function getChildNotes(parentNoteId) {
  const notes = await userNotesCollection();
  return notes
    .filter((note) => String(note.parentNoteId) === String(parentNoteId))
    .toArray();
}

export async function getAllNotesWithFolders() {
  const [notesCollection, foldersCollection] = await Promise.all([
    userNotesCollection(),
    userFoldersCollection(),
  ]);

  const [notes, folders] = await Promise.all([
    notesCollection.toArray(),
    foldersCollection.toArray(),
  ]);

  const folderMap = {};
  for (const folder of folders) {
    folderMap[String(folder.id)] = folder.name;
  }

  const rootNotes = notes.filter(
    (note) => note.parentNoteId === null || note.parentNoteId === undefined
  );

  return rootNotes.map((note) => ({
    ...note,
    folderName: folderMap[String(note.folderId)] || "Unknown",
  }));
}

export async function saveEntities(entities, sourceNoteId = null) {
  if (!Array.isArray(entities) || entities.length === 0) return [];

  const userId = getRequiredUserId();
  const existing = await db.entities.where("userId").equals(userId).toArray();
  const saved = [];

  for (const entity of entities) {
    if (!entity?.name || !entity?.type) continue;
    const match = existing.find(
      (row) => row.name === entity.name && row.type === entity.type
    );
    if (match) {
      saved.push(match);
      continue;
    }

    const record = {
      id: makeId(),
      userId,
      name: entity.name,
      type: entity.type,
      sourceNoteId: sourceNoteId == null ? null : String(sourceNoteId),
      createdAt: new Date(),
    };
    await db.entities.add(record);
    existing.push(record);
    saved.push(record);
  }

  return saved;
}

export async function getEntitiesForUser() {
  const userId = getRequiredUserId();
  return db.entities.where("userId").equals(userId).toArray();
}

export async function getEntitiesByNames(names) {
  if (!Array.isArray(names) || names.length === 0) return [];
  const userId = getRequiredUserId();
  const all = await db.entities.where("userId").equals(userId).toArray();
  const nameSet = new Set(names.map((n) => String(n).trim()).filter(Boolean));
  return all.filter((entity) => nameSet.has(entity.name));
}

async function collectDescendantNotes(rootNoteId) {
  const results = [];
  const root = await getNoteById(rootNoteId);
  if (!root) return results;

  async function walk(noteId) {
    const note = await getNoteById(noteId);
    if (!note) return;
    results.push(note);
    const children = await getChildNotes(noteId);
    for (const child of children) {
      await walk(child.id);
    }
  }

  await walk(rootNoteId);
  return results;
}

export async function getEntitiesForNoteTree(rootNoteId) {
  const notes = await collectDescendantNotes(rootNoteId);
  const refNames = new Set();
  for (const note of notes) {
    if (Array.isArray(note.entityRefs)) {
      note.entityRefs.forEach((name) => {
        if (name) refNames.add(String(name).trim());
      });
    }
  }
  return getEntitiesByNames([...refNames]);
}

// Finds an existing note in this folder with exactly this title and parent.
// Dedup key for organized notes: (user_id, folder_id, parent_note_id, title).
//
// parent_note_id is part of the key on purpose. Two sibling subtrees can each
// carry a child with the same generic label ("Notes", "Next steps"); matching
// on title alone would collapse them into one row and lose content. Oldest
// match wins, so repeat runs keep converging on the same row rather than
// ping-ponging between duplicates left over from earlier runs.
async function findOrganizedNoteByTitle(userId, folderId, title, parentNoteId) {
  const parent = parentNoteId == null ? null : String(parentNoteId);

  const matches = await db.notes
    .where("folderId")
    .equals(String(folderId))
    .filter((n) => {
      if (n.userId !== userId || n.title !== title) return false;
      const rowParent =
        n.parentNoteId === undefined || n.parentNoteId === null
          ? null
          : String(n.parentNoteId);
      return rowParent === parent;
    })
    .toArray();

  if (matches.length === 0) return null;
  matches.sort((a, b) => toDate(a.createdAt) - toDate(b.createdAt));
  return matches[0];
}

export async function createNotesFromTree(folderId, tree, parentNoteId = null) {
  const now = new Date();
  const userId = getRequiredUserId();
  const label = typeof tree.label === "string" ? tree.label.trim() : "Untitled";
  const title = label || "Untitled";
  const body = cleanNoteBody(tree.note, label);
  const entityRefs = Array.isArray(tree.entityRefs) ? tree.entityRefs : [];

  // DEDUPLICATION — update in place instead of inserting a second copy.
  //
  // Re-organizing the same content used to insert a whole fresh tree every
  // run, which is what accumulated ~150 orphaned duplicates.
  //
  // Skipped when the AI returned no label: "Untitled" is the fallback for a
  // missing label, so deduping on it would silently merge several genuinely
  // different unlabelled nodes into one and destroy their content.
  const parent = parentNoteId == null ? null : String(parentNoteId);

  const existing = label
    ? await findOrganizedNoteByTitle(userId, folderId, title, parent)
    : null;

  let noteId;

  if (existing) {
    const updated = {
      ...existing,
      title,
      body,
      entityRefs,
      parentNoteId: parent,
      updatedAt: now,
      syncStatus: "pending",
      lastSyncError: "",
    };
    await db.notes.put(updated);
    noteId = updated.id;

    await syncOrQueue({
      table: "notes",
      recordId: noteId,
      action: "upsert",
      payload: toRemoteNote(updated),
    });
  } else {
    const note = {
      id: makeId(),
      userId,
      folderId: String(folderId),
      // Threading the parent through is load-bearing, not incidental:
      // graph/page.js gates the AI organizer on
      // getChildNotes(rootNote.id).length === 0, and fetchDescendantTree
      // builds the mind map from the same links. Writing null here made that
      // guard always true (re-running the model on every visualise) and
      // flattened every rendered tree.
      parentNoteId: parent,
      title,
      body,
      entityRefs,
      createdAt: now,
      updatedAt: now,
      syncStatus: "pending",
      lastSyncError: "",
    };

    await db.notes.add(note);
    noteId = note.id;

    await syncOrQueue({
      table: "notes",
      recordId: note.id,
      action: "upsert",
      payload: toRemoteNote(note),
    });
  }

  if (Array.isArray(tree.children)) {
    for (const child of tree.children) {
      await createNotesFromTree(folderId, child, noteId);
    }
  }

  await touchFolder(folderId, now);

  return noteId;
}
