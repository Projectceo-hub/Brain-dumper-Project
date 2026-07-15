"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getFolderById,
  getNotesInFolder,
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
      fetchFolderAndNotes();
    }
  }, [folderId]);

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
    setEditingNote(note);
    setEditTitle(note.title || "");
    setEditBody(note.body || "");
  };

  const handleCloseEditor = async () => {
    // Flush any pending save immediately
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    if (editingNote) {
      await updateNote(editingNote.id, { title: editTitle, body: editBody });
    }
    setEditingNote(null);
    fetchFolderAndNotes();
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
      <div className="flex min-h-screen items-center justify-center bg-bone">
        <p className="font-sans text-warm-gray animate-pulse">Loading notes...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bone px-5 pt-6 pb-8 relative">
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
          notes.map((note) => (
            <div
              key={note.id}
              onClick={() => handleOpenEditor(note)}
              className="bg-white/60 hover:bg-white/80 transition-colors rounded-xl p-4 cursor-pointer relative"
            >
              <h2 className={`font-sans font-semibold text-ink text-base ${!note.title ? "text-warm-gray italic" : ""}`}>
                {note.title || "Untitled"}
              </h2>
              <p className="font-sans text-warm-gray text-sm mt-1 line-clamp-2 leading-relaxed">
                {note.body ? note.body.slice(0, 150) : "No content yet"}
              </p>
              <div className="flex items-center justify-between mt-4">
                <span className="text-warm-gray-light text-xs font-sans">
                  {getRelativeTimeString(note.updatedAt)}
                </span>
                <button
                  onClick={(e) => handleDeleteNote(e, note.id)}
                  className="text-warm-gray-light hover:text-clay text-xs font-sans transition-colors cursor-pointer"
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
        <div className="fixed inset-0 bg-bone z-50 flex flex-col px-5 pt-6 pb-8 overflow-y-auto">
          {/* Back button */}
          <div
            className="flex items-center gap-1 text-warm-gray hover:text-ink transition-colors cursor-pointer text-sm font-sans"
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
            className="w-full font-serif text-ink text-2xl bg-transparent outline-none border-none mt-4 placeholder-warm-gray-light font-bold"
          />

          {/* Body */}
          <textarea
            value={editBody}
            onChange={(e) => handleBodyChange(e.target.value)}
            placeholder="Start writing..."
            className="w-full flex-1 font-sans text-ink text-base bg-transparent outline-none border-none mt-4 resize-none placeholder-warm-gray-light leading-relaxed min-h-[300px]"
          />

          {/* Visualize Button */}
          <div className="mt-8 border-t border-warm-gray-light/20 pt-4 flex justify-center">
            <button
              onClick={() => {
                // Ensure save triggers before navigating
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
  );
}