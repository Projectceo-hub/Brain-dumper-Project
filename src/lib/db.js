import Dexie from "dexie";

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const db = new Dexie("MindCanvasDB");

db.version(1).stores({
  folders: "++id, name, createdAt, updatedAt",
  notes: "++id, folderId, parentNoteId, title, body, createdAt, updatedAt",
});

export default db;

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

/** Returns true if at least one folder exists (used by onboarding gate). */
export async function hasAnyFolders() {
  const count = await db.folders.count();
  return count > 0;
}

/**
 * Returns all folders sorted by updatedAt descending, each tagged with a
 * `size` field based on its recency rank:
 *   index 0 → 'hero'
 *   index 1 → 'med'   (sage background)
 *   index 2 → 'tan'   (tan background)
 *   index 3+ → 'default'
 */
export async function getFoldersForDashboard() {
  const folders = await db.folders.orderBy("updatedAt").reverse().toArray();

  return folders.map((folder, i) => {
    let size = "default";
    if (i === 0) size = "hero";
    else if (i === 1) size = "med";
    else if (i === 2) size = "tan";
    return { ...folder, size };
  });
}

/** Returns all folders as a simple list (sorted by name). */
export async function getAllFolders() {
  return db.folders.orderBy("name").toArray();
}

/** Creates a folder and returns its id. */
export async function createFolder(name) {
  const now = new Date();
  const id = await db.folders.add({
    name,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Gets a single folder by id. */
export async function getFolderById(id) {
  return db.folders.get(Number(id));
}

// ---------------------------------------------------------------------------
// Seed helpers (onboarding)
// ---------------------------------------------------------------------------

const SEED_PROFILES = {
  work: ["Projects", "Meetings", "Ideas"],
  personal: ["Journal", "Goals", "Inspiration"],
  study: ["Courses", "Research", "Reading List"],
};

/**
 * Creates starter folders for the chosen profile.
 * Only call this when hasAnyFolders() returns false.
 */
export async function seedFoldersForProfile(profile) {
  const names = SEED_PROFILES[profile] || SEED_PROFILES.work;
  const now = new Date();

  // Stagger updatedAt so the first folder is newest → becomes hero card
  const folders = names.map((name, i) => ({
    name,
    createdAt: now,
    updatedAt: new Date(now.getTime() - i * 1000), // 0s, -1s, -2s
  }));

  await db.folders.bulkAdd(folders);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** Returns notes in a folder sorted by updatedAt descending. Excluding child nodes. */
export async function getNotesInFolder(folderId) {
  const notes = await db.notes
    .where("folderId")
    .equals(Number(folderId))
    .reverse()
    .sortBy("updatedAt");
  return notes.filter((n) => n.parentNoteId === null || n.parentNoteId === undefined);
}

/** Creates a note and touches the parent folder's updatedAt. Returns note id. */
export async function createNote(folderId, title = "", body = "") {
  const now = new Date();
  const numericFolderId = Number(folderId);

  const id = await db.notes.add({
    folderId: numericFolderId,
    parentNoteId: null,
    title,
    body,
    createdAt: now,
    updatedAt: now,
  });

  // Touch folder
  await db.folders.update(numericFolderId, { updatedAt: now });

  return id;
}

/** Partial update of a note. Also touches the parent folder. */
export async function updateNote(noteId, changes) {
  const now = new Date();
  const numericId = Number(noteId);

  await db.notes.update(numericId, {
    ...changes,
    updatedAt: now,
  });

  // Touch folder
  const note = await db.notes.get(numericId);
  if (note) {
    await db.folders.update(note.folderId, { updatedAt: now });
  }
}

/** Deletes a note. Also touches the parent folder. */
export async function deleteNote(noteId) {
  const numericId = Number(noteId);
  const note = await db.notes.get(numericId);

  await db.notes.delete(numericId);

  if (note) {
    await db.folders.update(note.folderId, { updatedAt: new Date() });
  }
}

/** Get a single note by id. */
export async function getNoteById(noteId) {
  return db.notes.get(Number(noteId));
}

/** Get child notes linked via parentNoteId (for per-note graph). */
export async function getChildNotes(parentNoteId) {
  return db.notes
    .where("parentNoteId")
    .equals(Number(parentNoteId))
    .toArray();
}

/**
 * Returns all notes with their folder name attached (for global graph).
 * Each note gets an extra `folderName` field. Excluding child notes.
 */
export async function getAllNotesWithFolders() {
  const [notes, folders] = await Promise.all([
    db.notes.toArray(),
    db.folders.toArray(),
  ]);

  const folderMap = {};
  for (const f of folders) {
    folderMap[f.id] = f.name;
  }

  const rootNotes = notes.filter(
    (note) => note.parentNoteId === null || note.parentNoteId === undefined
  );

  return rootNotes.map((note) => ({
    ...note,
    folderName: folderMap[note.folderId] || "Unknown",
  }));
}

/**
 * Creates notes from an AI-organized tree structure.
 * Walks the tree recursively, creating notes with parentNoteId links.
 * Returns the id of the root note.
 */
export async function createNotesFromTree(folderId, tree, parentNoteId = null) {
  const now = new Date();
  const numericFolderId = Number(folderId);

  const noteId = await db.notes.add({
    folderId: numericFolderId,
    parentNoteId,
    title: tree.label || "Untitled",
    body: tree.note || "",
    createdAt: now,
    updatedAt: now,
  });

  // Recurse into children
  if (Array.isArray(tree.children)) {
    for (const child of tree.children) {
      await createNotesFromTree(numericFolderId, child, noteId);
    }
  }

  // Touch folder
  await db.folders.update(numericFolderId, { updatedAt: now });

  return noteId;
}
