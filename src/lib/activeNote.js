"use client";

// Phase 11 — the note the user currently has open, shared with the chat panel.
//
// NoteChat is mounted once in layout.js so "Ask AI" works on every route, but
// the editor state it needs lives in src/app/folder/[id]/page.js. Rather than
// lift editor state into a provider (which would re-render the editor tree on
// every keystroke and risk the hydration/wipe guards there), the editor writes
// the current note into this module and NoteChat reads it at send time.
//
// A plain module variable rather than React state is deliberate: the editor
// updates this on every keystroke so the chat sees unsaved text, and a state
// update at that frequency would re-render the panel constantly. Nothing
// subscribes to it — the value is only ever pulled, and only when a message
// is actually sent.

let current = null;

export function setActiveNote(note) {
  current = note
    ? {
        id: note.id,
        title: note.title || "",
        body: note.body || "",
      }
    : null;
}

export function getActiveNote() {
  return current;
}

export function clearActiveNote() {
  current = null;
}
