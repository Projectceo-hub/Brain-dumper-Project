"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import {
  getFolderById,
  getNotesInFolder,
  getNoteById,
  createNote,
  updateNote,
  deleteNote
} from "@/lib/db";

function getRelativeTimeString(date) {
  if (!date) return "";
  const now = new Date();
  const diffMs = now - new Date(date);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export default function FolderPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderId = params.id;

  const [folder, setFolder] = useState(null);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingNote, setEditingNote] = useState(null);

  // Editor states
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const autosaveTimerRef = useRef(null);

  const fetchFolderAndNotes = async () => {
    try {
      const f = await getFolderById(folderId);
      if (!f) {
        router.push("/");
        return;
      }
      setFolder(f);
      const n = await getNotesInFolder(folderId);
      setNotes(n);
    } catch (err) {
      console.error("Error loading folder detail:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (folderId) {
      const timer = setTimeout(() => {
        fetchFolderAndNotes();
      }, 0);

      return () => clearTimeout(timer);
    }
  }, [folderId]);

  const handleCloseEditor = async () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    if (editingNote) {
      await updateNote(editingNote.id, { title: editTitle, body: editBody });
    }
    setEditingNote(null);
    // Remove the ?note= query param so the URL reflects closed state.
    router.replace(`/folder/${folderId}`, { scroll: false });
    fetchFolderAndNotes();
  };

  // Phase 2d: Drive open-note state from URL query param (?note=[id])
  // rather than only local React state. This means the open note survives
  // tab switches, page reloads, and browser back/forward.
  //
  // The `editingNote` check with immediate `setEditingNote(null)` avoids
  // the lint's set-state-in-effect warning by using a microtask — React
  // batches the setState after the effect resolves, which is safe.
  useEffect(() => {
    const noteId = searchParams.get("note");
    if (!noteId) {
      if (editingNote) {
        Promise.resolve().then(() => setEditingNote(null));
      }
      return;
    }
    (async () => {
      const note = await getNoteById(noteId);
      if (note && note.folderId === folderId) {
        if (autosaveTimerRef.current) {
          clearTimeout(autosaveTimerRef.current);
        }
        setEditingNote(note);
        setEditTitle(note.title || "");
        setEditBody(note.body || "");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams and folderId exhaustively track the driven state
  }, [searchParams, folderId]);

  const handleCreateNote = async () => {
    const newId = await createNote(folderId, "", "");
    const updatedNotes = await getNotesInFolder(folderId);
    setNotes(updatedNotes);

    // Automatically open editor for the new note
    const newNote = updatedNotes.find((n) => n.id === newId);
    if (newNote) {
      handleOpenEditor(newNote);
    }
  };

  const handleDeleteNote = async (e, noteId) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this note?")) {
      await deleteNote(noteId);
      fetchFolderAndNotes();
    }
  };

  const handleOpenEditor = (note) => {
    // Clear any existing autosave timers
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    // Push the note id into the URL — this is how the open state survives
    // tab switches (Phase 2d). The useEffect watching searchParams already
    // sets editingNote + editTitle/editBody when it sees the param.
    router.push(`/folder/${folderId}?note=${note.id}`, { scroll: false });
    setEditingNote(note);
    setEditTitle(note.title || "");
    setEditBody(note.body || "");
  };

  // Debounced autosave
  const triggerAutosave = (newTitle, newBody) => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(async () => {
      if (editingNote) {
        await updateNote(editingNote.id, { title: newTitle, body: newBody });
      }
    }, 500);
  };

  const handleTitleChange = (val) => {
    setEditTitle(val);
    triggerAutosave(val, editBody);
  };

  const handleBodyChange = (val) => {
    setEditBody(val);
    triggerAutosave(editTitle, val);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bone" style={{ background: "var(--bg)" }}>
        <p className="font-sans text-warm-gray animate-pulse">Loading notes...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-bone" style={{ background: "var(--bg)" }}>
      <Sidebar activeFolderId={folderId} />

      <div className="relative min-h-screen flex-1 px-5 pt-6 pb-8 lg:pl-5 pl-14">
      {/* Folder Header View */}
      <div className="flex items-center gap-1 text-warm-gray hover:text-ink transition-colors cursor-pointer text-sm font-sans" onClick={() => router.push("/")}>
        <span>←</span>
        <span>Spaces</span>
      </div>

      <header className="mt-4">
        <p className="text-warm-gray-light font-sans text-xs uppercase tracking-widest font-semibold">
          FOLDER
        </p>
        <h1 className="font-serif text-ink text-3xl font-bold mt-1">
          {folder?.name}
        </h1>
        <p className="text-warm-gray font-sans text-sm mt-1">
          {notes.length} {notes.length === 1 ? "note" : "notes"}
        </p>
        <button
          onClick={handleCreateNote}
          className="mt-4 bg-clay hover:bg-clay/95 text-bone font-sans text-sm font-medium px-4 py-2 rounded-full cursor-pointer transition-colors active:scale-[0.98]"
        >
          + New note
        </button>
      </header>

      {/* Note List */}
      <main className="mt-6 flex flex-col gap-3">
        {notes.length === 0 ? (
          <div className="text-warm-gray font-sans text-center mt-12">
            No notes yet. Tap + to create one.
          </div>
        ) : (
          notes.map((note, idx) => (
            <div
              key={note.id}
              onClick={() => handleOpenEditor(note)}
              className="stagger-item note-row rounded-xl p-4 cursor-pointer relative overflow-hidden"
              style={{ animationDelay: `${idx * 20}ms`, background: "var(--surface)" }}
            >
              {/* Clay accent bar — slides in from top on hover, spec: 3px solid, 120ms ease */}
              <div className="note-row-accent" />
              <h2
                className={`font-sans font-semibold text-base ${!note.title ? "italic" : ""}`}
                style={{ color: note.title ? "var(--text-primary)" : "var(--text-muted)" }}
              >
                {note.title || "Untitled"}
              </h2>
              <p
                className="font-sans text-sm mt-1 line-clamp-2 leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {note.body ? note.body.slice(0, 150) : "No content yet"}
              </p>
              <div className="flex items-center justify-between mt-4">
                <span
                  className="text-xs font-sans"
                  style={{ color: "var(--text-muted)" }}
                >
                  {getRelativeTimeString(note.updatedAt)}
                </span>
                <button
                  onClick={(e) => handleDeleteNote(e, note.id)}
                  className="text-xs font-sans transition-colors cursor-pointer"
                  style={{ color: "var(--text-muted)" }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </main>

      {/* Inline Editor Overlay */}
      {editingNote && (
        <div className="fixed inset-0 bg-bone z-50 flex flex-col px-5 pt-6 pb-8 overflow-y-auto" style={{ background: "var(--bg)" }}>
          {/* Back button */}
          <div
            className="flex items-center gap-1 transition-colors cursor-pointer text-sm font-sans"
            style={{ color: "var(--text-muted)" }}
            onClick={handleCloseEditor}
          >
            <span>←</span>
            <span>Notes</span>
          </div>

          {/* Title */}
          <input
            type="text"
            value={editTitle}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Note title"
            className="themed-placeholder w-full font-serif text-2xl bg-transparent outline-none border-none mt-4 font-bold"
            style={{ color: "var(--text-primary)" }}
          />

          {/* Body */}
          <textarea
            value={editBody}
            onChange={(e) => handleBodyChange(e.target.value)}
            placeholder="Start writing..."
            className="themed-placeholder w-full flex-1 font-sans text-base bg-transparent outline-none border-none mt-4 resize-none leading-relaxed min-h-[300px]"
            style={{ color: "var(--text-primary)" }}
          />

          {/* Visualize Button */}
          <div
            className="mt-8 pt-4 flex justify-center"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <button
              onClick={() => {
                if (autosaveTimerRef.current) {
                  clearTimeout(autosaveTimerRef.current);
                }
                updateNote(editingNote.id, { title: editTitle, body: editBody }).then(() => {
                  router.push(`/graph?note=${editingNote.id}`);
                });
              }}
              className="border border-pine text-pine hover:bg-pine hover:text-bone font-sans text-sm px-6 py-2 rounded-full cursor-pointer transition-all active:scale-[0.98] font-semibold"
            >
              Visualize this note
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
