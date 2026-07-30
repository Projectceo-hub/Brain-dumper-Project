"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import {
  getFolderById,
  getNotesInFolder,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
  getAllNotesWithFolders,
  createNoteLink,
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

// ---------------------------------------------------------------------------
// Mention serialization
// ---------------------------------------------------------------------------
//
// The note body is stored as plain text in Supabase (exactly like before —
// the body column is still `text`). Mention spans are encoded inline as:
//
//   @[noteId|noteTitle]
//
// On load, `deserializeBody` parses those tokens back into clickable spans
// via the proven contenteditable pattern ported from /dev-mention-test.
// On save, `serializeEditor` walks the editor DOM and produces the same
// `@[id|title]` text for every atomic mention span, so the saved body
// round-trips. A mention whose target note has been deleted is rendered as
// plain gray non-clickable text and is left in the body as the literal
// `@[id|title]` token — no crash, no navigation.

const MENTION_RE = /@\[([^\]|]+)\|([^\]]*)\]/g;

function stripOldWikilinkArtifact(text) {
  // Defensive: nothing to do here. Kept as a hook in case a future phase
  // needs to migrate body content. Currently a passthrough.
  return text;
}

// Build the @picker results for a query against the user's real notes.
// Excludes the note currently being edited (you can't mention yourself in
// a way that creates a self-referencing link — note_links has a unique
// (source, target) constraint and a self-row would be meaningless).
function filterNotesForPicker(allNotes, query, excludeNoteId) {
  const q = (query || "").toLowerCase().trim();
  return allNotes.filter((n) => {
    if (excludeNoteId && String(n.id) === String(excludeNoteId)) return false;
    if (!n.title) return false;
    if (!q) return true;
    return n.title.toLowerCase().includes(q);
  });
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

  // DATA-LOSS-RACE FIX #2 (close-during-hydration).
  //
  // The editor DOM is hydrated asynchronously (see the hydrate effect
  // below: requestAnimationFrame -> await getNoteById -> innerHTML = "" ->
  // one await per @mention token -> appendChild). Until that finishes, the
  // contenteditable is EMPTY even though `editingNote` already points at a
  // note with real content. Serializing it in that window yields "" — and
  // writing that over the note is the wipe traced to page.js:234
  // (handleCloseEditor -> updateNote, prevBodyLen 11389 -> nextBodyLen 0).
  //
  // `hydratedNoteIdRef` holds the id of the note whose content is actually
  // present in the DOM right now. It is cleared synchronously when a
  // hydration starts and only set once hydration has genuinely completed,
  // so "is the DOM trustworthy?" is a single ref comparison.
  //
  // `editorDirtyRef` records whether the user has typed into this note's
  // editor during this open. It is what distinguishes a real "user deleted
  // all the text" (dirty + hydrated + empty DOM => legitimate, must be
  // allowed to save) from the race (not dirty and/or not hydrated + empty
  // DOM => refuse the write).
  const hydratedNoteIdRef = useRef(null);
  const editorDirtyRef = useRef(false);

  // ---- DATA-LOSS-RACE DIAGNOSTIC LOGGING ----------------------------------
  // A bug has been reported where switching tabs and back intermittently
  // wipes the note body (title survives). These logs trace the exact
  // sequence of fetch/render/save calls around a tab switch so we can
  // pinpoint which function writes body="" over existing content before
  // patching. All logs prefixed `[MC-DBG]` for easy console filtering.
  // Remove this entire block once the bug is confirmed fixed.
  const dbgSeqRef = useRef(0);
  const dbg = useCallback((label, extra = {}) => {
    const seq = ++dbgSeqRef.current;
    const noteId = editingNote?.id || "(none)";
    const bodyLen =
      editorRef.current ? serializeEditor(editorRef.current).length : -1;
    const payload = {
      seq,
      label,
      noteId,
      stateEditTitleLen: (editTitle || "").length,
      stateEditBodyLen: (editBody || "").length,
      domBodyLen: bodyLen,
      timerArmed: Boolean(autosaveTimerRef.current),
      ...extra,
    };
    console.log("[MC-DBG]", label, payload);
  }, [editingNote, editTitle, editBody]);

  // Trace tab visibility so we can correlate the wipe with a focus change.
  useEffect(() => {
    const onVis = () => {
      console.log("[MC-DBG] visibilitychange ->", document.visibilityState, {
        seq: ++dbgSeqRef.current,
        ts: Date.now(),
      });
    };
    const onFocus = () => {
      console.log("[MC-DBG] window focus", {
        seq: ++dbgSeqRef.current,
        ts: Date.now(),
      });
    };
    const onBlur = () => {
      console.log("[MC-DBG] window blur", {
        seq: ++dbgSeqRef.current,
        ts: Date.now(),
      });
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  // ---- end diagnostic -----------------------------------------------------

  // Mention picker state + the user's full note list picker draws from.
  const editorRef = useRef(null);
  const dropdownRef = useRef(null);
  const [allNotes, setAllNotes] = useState([]);
  const [mention, setMention] = useState({
    open: false,
    query: "",
    startIndex: null,
    results: [],
    activeIndex: 0,
  });

  // Lock the document scroll while the editor overlay is open.
  //
  // The overlay covers the viewport, but the folder page behind it (header
  // + note list) is still in normal flow and still taller than the screen,
  // so `html` keeps its own scrollbar. That is the second scrollbar the
  // user sees next to the overlay's — and dragging it scrolls the hidden
  // list rather than the note, which reads as "the scrollbar doesn't reach
  // the end". Suppressing it leaves exactly one scroll container: the
  // overlay's content pane.
  useEffect(() => {
    if (!editingNote) return;
    // Both elements: `body` alone is not enough because the document
    // scroller here is `html` (body is display:flex with min-height:100%,
    // so it stretches to content and `html` is what actually overflows).
    const root = document.documentElement;
    const prevRoot = root.style.overflow;
    const prevBody = document.body.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      root.style.overflow = prevRoot;
      document.body.style.overflow = prevBody;
    };
  }, [editingNote]);

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

  // DATA-LOSS-RACE FIX (Phase 6 Part C follow-up).
  //
  // On unmount (whether from a deliberate close, a route change, OR an
  // upstream-parent remount), clear any pending autosave timer. If we
  // don't, the timer's closure keeps a stale snapshot of `editBody`
  // from the dying mount and may fire after a new mount has begun —
  // writing `{ title: <stale>, body: <stale or empty> }` over the note's
  // actual content. This is defense-in-depth behind the AuthGate fix
  // (which kills the upstream remount) so that even if some future
  // code path causes the editor to remount, no stale save escapes.
  // Per the [MC-DBG] instrumentation already in place, this cleanup
  // should fire alongside `hydrate-cleanup` whenever the editor unmounts.
    useEffect(() => {
      return () => {
        if (autosaveTimerRef.current) {
          console.log("[MC-DBG] unmount-clearing orphaned autosave timer", {
            seq: ++dbgSeqRef.current,
          });
          clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
      };
    }, []);

  useEffect(() => {
    if (folderId) {
      const timer = setTimeout(() => {
        fetchFolderAndNotes();
      }, 0);

      return () => clearTimeout(timer);
    }
  }, [folderId]);

  // Hydrate the full-notes list used by the @picker once the editor is
  // mounted. Re-fetch whenever the editor opens a different note so newly
  // created notes show up in the picker immediately.
  useEffect(() => {
    if (!editingNote) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await getAllNotesWithFolders();
        if (!cancelled) setAllNotes(list);
      } catch (err) {
        console.error("Failed to load notes for @mention picker:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildMentionSpan depends on editingNote; we intentionally only re-run on id change so typing doesn't wipe the caret
  }, [editingNote?.id]);

  // WIPE-GUARD for DOM-sourced writes (same intent as the autosave timer's
  // guard, different rescue strategy).
  //
  // The autosave guard can rescue a body because it compares a captured
  // *state* snapshot against the DOM and prefers the DOM. Here the DOM IS
  // the thing that's empty, so there is nothing to rescue from — the
  // correct action is to REFUSE the body write and leave the stored body
  // untouched.
  //
  // Returns the body string to persist, or `null` meaning "do not write a
  // body at all". A null return is not an error path in the normal sense:
  // it means the note is being closed before its content ever reached the
  // DOM, so by definition the body cannot have changed.
  //
  // Legitimate empty bodies are still saved: if the editor hydrated for
  // THIS note and the user actually typed in it, an empty serialization is
  // a real deletion and is written through.
  const resolveBodyForSave = async (label) => {
    const editor = editorRef.current;
    if (!editingNote || !editor) return null;

    const body = serializeEditor(editor);
    if (body.length > 0) return body;

    const hydrated = hydratedNoteIdRef.current === editingNote.id;
    const dirty = editorDirtyRef.current;

    let storedLen = 0;
    try {
      const stored = await getNoteById(editingNote.id);
      storedLen = (stored?.body || "").length;
    } catch {
      // Can't confirm what's stored — treat as "unknown", and fall through
      // to the guard below, which errs on the side of not writing.
      storedLen = -1;
    }

    // Empty DOM over a note known (or not confirmed) to have content, and
    // no evidence the user emptied it themselves => the hydration race.
    if (storedLen !== 0 && !(hydrated && dirty)) {
      console.warn("[MC-DBG] CLOSE-WIPE-GUARD refused empty body write", {
        seq: ++dbgSeqRef.current,
        label,
        noteId: editingNote.id,
        storedBodyLen: storedLen,
        domBodyLen: 0,
        hydratedForThisNote: hydrated,
        hydratedNoteId: hydratedNoteIdRef.current || "(none)",
        userTypedInEditor: dirty,
        reason: hydrated
          ? "editor hydrated but user never typed — body cannot have changed"
          : "editor DOM not hydrated yet — serialization would be a false empty",
      });
      return null;
    }

    return body;
  };

  const handleCloseEditor = async () => {
    dbg("handleCloseEditor-start");
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (editingNote && editorRef.current) {
      const body = await resolveBodyForSave("handleCloseEditor");
      if (body === null) {
        // Title still persists — it comes from React state that was set
        // synchronously when the note opened, so it is not subject to the
        // hydration race. Omitting `body` from `changes` leaves the stored
        // body untouched (updateNote spreads changes over the existing row).
        dbg("handleCloseEditor-save-body-refused", {
          titleLen: (editTitle || "").length,
        });
        await updateNote(editingNote.id, { title: editTitle });
      } else {
        dbg("handleCloseEditor-save", { bodyLen: body.length });
        await updateNote(editingNote.id, { title: editTitle, body });
      }
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
    dbg("url-effect-run", { urlNoteId: noteId });
    if (!noteId) {
      if (editingNote) {
        dbg("url-effect-clear-editingNote");
        Promise.resolve().then(() => setEditingNote(null));
      }
      return;
    }
    (async () => {
      const note = await getNoteById(noteId);
      dbg("url-effect-fetched", {
        found: Boolean(note),
        fetchedBodyLen: note ? (note.body || "").length : -1,
        sameIdAsEditing: note && editingNote && String(note.id) === String(editingNote.id),
      });
      if (note && note.folderId === folderId) {
        if (autosaveTimerRef.current) {
          clearTimeout(autosaveTimerRef.current);
        }
        dbg("url-effect-apply", {
          oldEditBodyLen: (editBody || "").length,
          newEditBodyLen: (note.body || "").length,
          stateAlreadyDifferent: editingNote && String(note.id) === String(editingNote.id)
            ? "same-note-overwrite"
            : "switching-notes",
        });
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
    dbg("handleOpenEditor", { openId: note.id, noteBodyLen: (note.body||"").length });
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

  // Debounced autosave. Body is serialized from the contenteditable DOM
  // so mentions become `@[id|title]` text before being written to Supabase.
  //
  // DATA-LOSS-RACE FIX (Phase 6 Part C follow-up): the timer body refuses
  // to write an empty body unless the editor DOM is also genuinely empty —
  // see the WIPE-GUARD block below. This catches the exact race where a
  // stale `editBody=""` state captured by the closure gets propagated to
  // storage while the editor DOM still holds the user's actual text.
  const triggerAutosave = useCallback(
    (newTitle, newBody) => {
      dbg("triggerAutosave-schedule", {
        newTitleLen: (newTitle || "").length,
        newBodyLen: (newBody || "").length,
      });
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }

      autosaveTimerRef.current = setTimeout(async () => {
        const editingId = editingNote?.id;
        const capturedBody = (newBody || "").length;
        const domLen = editorRef.current
          ? serializeEditor(editorRef.current).length
          : -1;
        dbg("autosave-timer-fire", {
          editingId,
          capturedTitleLen: (newTitle || "").length,
          capturedBodyLen: capturedBody,
          domBodyLen: domLen,
        });
        if (!editingId) {
          dbg("autosave-timer-fire-skip (no editingNote)");
          return;
        }

        // WIPE-GUARD — refuse to write an empty body over a note whose
        // editor DOM still contains text. The only legitimate path to an
        // empty body is the user manually deleting all text in the editor,
        // which would produce domBodyLen === 0 too. Any other combination
        // — captured body empty BUT DOM populated — means the closure
        // captured a stale empty `editBody` while the DOM has the user's
        // real text (the exact wipe race we traced). In that case, prefer
        // the editor DOM as the source of truth for the body so the user's
        // text is preserved.
        let bodyToSave = newBody;
        if (capturedBody === 0 && domLen > 0) {
          bodyToSave = serializeEditor(editorRef.current);
          console.warn(
            "[MC-DBG] WIPE-GUARD triggered — rescued body from DOM",
            {
              seq: ++dbgSeqRef.current,
              editingId,
              capturedBodyLen: 0,
              rescuedLen: (bodyToSave || "").length,
            },
          );
        }

        dbg("autosave-timer-fire-write", {
          titleLen: (newTitle || "").length,
          bodyLen: (bodyToSave || "").length,
          bodyWillBeEmpty: (bodyToSave || "").length === 0,
          guardFired: bodyToSave !== newBody,
        });
        await updateNote(editingId, { title: newTitle, body: bodyToSave });
      }, 500);
    },
    [editingNote, dbg],
  );

  const handleTitleChange = (val) => {
    dbg("handleTitleChange", { valLen: val.length, editBodyLen: (editBody||"").length });
    setEditTitle(val);
    triggerAutosave(val, editBody);
  };

  // The contenteditable editor fires its own "input" event (native) on
  // every keystroke. The handler below serializes the DOM, updates the
  // editBody state, and schedules autosave — exactly the same pattern as
  // the original textarea's onChange, just sourcing the value from the
  // contenteditable instead.
  const handleEditorInput = (e) => {
    const editor = e.currentTarget;
    // The user has touched this note's editor. From here on, an empty
    // serialization is a real edit rather than an un-hydrated DOM, so the
    // close-time wipe guard will let an empty body through.
    editorDirtyRef.current = true;
    handleMentionDetection(editor);
    const body = serializeEditor(editor);
    dbg("handleEditorInput", { domLen: body.length });
    setEditBody(body);
    triggerAutosave(editTitle, body);
  };

  // --- Mention picker -------------------------------------------------------
  //
  // Ported verbatim in spirit from /dev-mention-test/page.js. The only
  // differences:
  //   - results come from the user's real notes (`allNotes`) instead of
  //     the fake Alpha/Beta/Gamma list
  //   - each result carries an id + title+folderName (used to render the
  //     picker rows and to build `@[id|title]` tokens)

  const closeMention = useCallback(() => {
    setMention({
      open: false,
      query: "",
      startIndex: null,
      results: [],
      activeIndex: 0,
    });
  }, []);

  const handleMentionDetection = (editor) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      closeMention();
      return;
    }

    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      closeMention();
      return;
    }

    const caretOffset = range.startOffset;
    const node = range.startContainer;
    const text = node.nodeType === Node.TEXT_NODE ? node.textContent : "";

    let i = caretOffset - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === "@") {
        const before = i === 0 || /\s/.test(text[i - 1] || " ");
        if (before) {
          const query = text.slice(i + 1, caretOffset);
          if (!/\s/.test(query)) {
            const results = filterNotesForPicker(
              allNotes,
              query,
              editingNote?.id,
            );
            setMention({
              open: true,
              query,
              startIndex: i,
              results,
              activeIndex: 0,
            });
            return;
          }
        }
        closeMention();
        return;
      }
      if (/\s/.test(ch)) {
        closeMention();
        return;
      }
      i--;
    }
    closeMention();
  };

  const handleEditorKeyDown = (e) => {
    if (mention.open && mention.results.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setMention((m) => ({
          ...m,
          activeIndex: (m.activeIndex + 1) % m.results.length,
        }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setMention((m) => ({
          ...m,
          activeIndex:
            (m.activeIndex - 1 + m.results.length) % m.results.length,
        }));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const note = mention.results[mention.activeIndex];
        acceptMention(note);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMention();
        return;
      }
    }
  };

  // Build the atomic mention span. `clickHandler` is wired separately so we
  // can attach a fresh closure that knows the *current* router, and so the
  // serialize/deserialize code can share one builder. The span carries the
  // id and the title separately so renames don't break navigation.
  const buildMentionSpan = (noteId, title) => {
    const span = document.createElement("span");
    span.setAttribute("contenteditable", "false");
    span.setAttribute("data-mention-id", String(noteId));
    span.setAttribute("data-mention-name", String(title || ""));
    span.className = "mention-token";
    span.textContent = `@${title || "untitled"}`;
    span.addEventListener("click", (e) => {
      e.preventDefault();
      handleMentionClick(String(noteId));
    });
    return span;
  };

  // Mention click → navigate to the mentioned note's actual page, using the
  // existing `router.push(/folder/?note=)` navigation pattern. If the
  // target has been deleted, the span shouldn't have been clickable
  // (deserialize renders those as plain text), so this is a final safety
  // net.
  const handleMentionClick = async (noteId) => {
    if (!noteId) return;
    const target = await getNoteById(noteId);
    if (!target) return;
    router.push(`/folder/${target.folderId}?note=${target.id}`, {
      scroll: false,
    });
  };

  // Replace the `@query` text the user typed with the atomic mention span
  // for the picked note, then write a real note_link row.
  const acceptMention = (note) => {
    if (!note) return;
    const editor = editorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    let textNode = range.startContainer;
    let offset = range.startOffset;

    if (textNode.nodeType !== Node.TEXT_NODE) {
      const walker = document.createTreeWalker(
        editor,
        NodeFilter.SHOW_TEXT,
        null,
      );
      let n = walker.currentNode;
      while (n) {
        if (n.nodeValue && n.nodeValue.includes("@")) {
          textNode = n;
          break;
        }
        n = walker.nextNode();
      }
    }

    if (textNode.nodeType === Node.TEXT_NODE) {
      const text = textNode.textContent || "";
      const at = mention.startIndex;
      if (at != null && at >= 0 && at < text.length && text[at] === "@") {
        const newRange = document.createRange();
        newRange.setStart(textNode, at);
        newRange.setEnd(textNode, offset);
        sel.removeAllRanges();
        sel.addRange(newRange);
        newRange.deleteContents();

        const span = buildMentionSpan(note.id, note.title);
        newRange.insertNode(span);

        const space = document.createTextNode("\u00A0");
        const afterRange = document.createRange();
        afterRange.setStartAfter(span);
        afterRange.setEndAfter(span);
        afterRange.insertNode(space);

        const finalRange = document.createRange();
        finalRange.setStartAfter(space);
        finalRange.setEndAfter(space);
        sel.removeAllRanges();
        sel.addRange(finalRange);
      }
    }

    closeMention();
    editor.normalize();

    // Write the real note_link row. Fire-and-forget — the editor DOM is
    // already updated; a sync failure just means the link will be queued
    // and retried later by retryPendingSync (same pattern as note writes).
    if (editingNote) {
      createNoteLink(editingNote.id, note.id).catch((err) => {
        console.warn("createNoteLink failed (will retry on next sync):", err);
      });
    }

    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const handleDropdownClick = (note) => {
    acceptMention(note);
    if (editorRef.current) editorRef.current.focus();
  };

  // --- Hydrate the contenteditable from the saved body ---------------------
  //
  // When `editingNote` changes (open note, URL-driven reload), rehydrate
  // the editor DOM from the note's stored body. We resolve each
  // `@[id|title]` token: if the target note still exists → clickable
  // span; if it's been deleted → plain gray non-clickable text.
  //
  // IMPORTANT: this effect keys on `editingNote?.id` ONLY — it must NOT
  // re-run when the user types, because re-rendering innerHTML on every
  // keystroke would destroy the caret position (this was the failure
  // mode of an earlier attempt at this feature). The body used here is
  // the snapshot loaded fresh from Dexie when the note opened, so it's
  // never stale with respect to what the user is currently typing.
  useEffect(() => {
    // These two early returns were silent, which hid the fact that the
    // effect can bail before ever scheduling hydration. Logged so the
    // [MC-DBG] trace shows a bail rather than just an absence of logs.
    if (!editingNote) {
      dbg("hydrate-effect-bail", { why: "no editingNote" });
      return;
    }
    const editor = editorRef.current;
    if (!editor) {
      dbg("hydrate-effect-bail", { why: "editorRef.current is null", noteId: editingNote.id });
      return;
    }
    dbg("hydrate-effect-run", { noteId: editingNote.id });

    let cancelled = false;

    // Synchronously mark the DOM as NOT representing this note. Everything
    // below is async, so from this line until hydration completes any
    // serialize of the editor is meaningless. Writers consult this ref
    // before persisting a body. (A stale id from the previously-open note
    // would already fail the `=== editingNote.id` comparison, but clearing
    // it here keeps the invariant explicit rather than incidental.)
    hydratedNoteIdRef.current = null;
    editorDirtyRef.current = false;

    // Defer to the next frame so the contenteditable has actually mounted
    // in the DOM (the overlay only renders when editingNote is set).
    const raf = requestAnimationFrame(async () => {
      // Always re-read the note from Dexie so we hydrate from a fresh
      // snapshot rather than from possibly-stale editBody state.
      let freshBody = "";
      let fetchedLen = -1;
      try {
        const fresh = await getNoteById(editingNote.id);
        freshBody = (fresh && fresh.body) || "";
        fetchedLen = freshBody.length;
      } catch {
        freshBody = editBody;
        fetchedLen = freshBody.length;
      }
      dbg("hydrate-raf-fire", { fetchedLen, cancelled });
      if (cancelled) return;
      // MUST be awaited: hydrateEditorFromBody is async and clears
      // innerHTML BEFORE its per-mention awaits, so it leaves the editor
      // empty for the whole duration. Previously this was fire-and-forget,
      // which meant `hydrate-raf-applied` logged while the DOM was still
      // blank — understating the exact window this fix guards.
      await hydrateEditorFromBody(editor, freshBody, buildMentionSpan);
      if (cancelled) return;
      // Only now does the DOM actually represent this note.
      hydratedNoteIdRef.current = editingNote.id;
      dbg("hydrate-raf-applied", { appliedLen: fetchedLen, hydratedFor: editingNote.id });
    });
    return () => {
      dbg("hydrate-cleanup", { cancellingRaf: true });
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildMentionSpan depends on editingNote but we only re-run on id change, intentionally
  }, [editingNote?.id]);

  // Paste handler — same as the prototype: strip rich text and insert
  // plain-text only, so pasted `@[id|title]` tokens still deserialize on a
  // future reload but pasted HTML doesn't pollute the editor.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const handlePaste = (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
      }
    };
    editor.addEventListener("paste", handlePaste);
    return () => editor.removeEventListener("paste", handlePaste);
  }, [editingNote]);

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
                {note.body ? renderBodyPreview(note.body) : "No content yet"}
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
        /* The overlay itself is a NON-scrolling viewport-sized flex column.
           Scrolling belongs to exactly one child (the content pane below);
           the footer is a sibling of that pane, so it is pinned to the
           bottom of the viewport without needing position:fixed and
           without overlapping the text. */
        <div className="fixed inset-0 bg-bone z-50 flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
          {/* THE single scroll container for the note.
              `min-h-0` is load-bearing: a flex child defaults to
              `min-height:auto`, which refuses to shrink below its content
              and would push the footer off-screen instead of scrolling.
              `pb-16` keeps the last line clear of the footer edge. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-6 pb-16">
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

          {/* Body — contenteditable with @mention support.
              Same structural role as the previous <textarea> (full-width,
              flex-1, same top margin, same min-height) so layout is
              unchanged. The mention dropdown is positioned relative to
              this wrapper. */}
          {/* `flex-1` was removed here: the parent is now the block-level
              scroll pane, not a flex column, so flex-grow did nothing —
              and while it WAS a flex child, `flex-1` (flex-basis:0) paired
              with an explicit min-height let this wrapper size itself
              shorter than the contenteditable inside it. */}
          <div className="relative w-full mt-4 min-h-[300px]">
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={handleEditorInput}
              onKeyDown={handleEditorKeyDown}
              data-ph="Start writing... use @ to mention a note"
              className="themed-placeholder-CE w-full font-sans text-base bg-transparent outline-none border-none resize-none leading-relaxed min-h-[300px]"
              style={{
                color: "var(--text-primary)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                minHeight: "300px",
              }}
            />

            {mention.open && mention.results.length > 0 && (
              <div
                ref={dropdownRef}
                className="mention-dropdown"
              >
                {mention.results.map((note, idx) => (
                  <div
                    key={note.id}
                    role="option"
                    aria-selected={mention.activeIndex === idx}
                    tabIndex={-1}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleDropdownClick(note);
                    }}
                    className={
                      "mention-dropdown-row" +
                      (mention.activeIndex === idx
                        ? " mention-dropdown-row-active"
                        : "")
                    }
                  >
                    <span className="mention-dropdown-row-name">
                      @{note.title || "untitled"}
                    </span>
                    <span className="mention-dropdown-row-folder">
                      {note.folderName || ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
          {/* end of the single scroll container */}

          {/* Visualize Button — pinned footer. `shrink-0` keeps it at its
              natural height so the scroll pane above absorbs all remaining
              space; it never scrolls out of view no matter how long the
              note is. */}
          <div
            className="shrink-0 flex justify-center px-5 py-4"
            style={{
              borderTop: "1px solid var(--border)",
              background: "var(--bg)",
            }}
          >
            <button
              onClick={async () => {
                // Same unguarded serialize->updateNote shape as the old
                // handleCloseEditor, so it carries the same wipe risk if
                // clicked during the hydration window. Routed through the
                // same guard.
                if (autosaveTimerRef.current) {
                  clearTimeout(autosaveTimerRef.current);
                  autosaveTimerRef.current = null;
                }
                const noteId = editingNote.id;
                const body = await resolveBodyForSave("visualize-button");
                await updateNote(
                  noteId,
                  body === null
                    ? { title: editTitle }
                    : { title: editTitle, body },
                );
                router.push(`/graph?note=${noteId}`);
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

// ---------------------------------------------------------------------------
// Standalone helpers (module scope — used by the component above)
// ---------------------------------------------------------------------------

// Serializes the contenteditable editor DOM back to a plain-text body,
// replacing each atomic mention span with its `@[id|title]` token. BR
// tags and the div boundaries contenteditable inserts on Enter turn into
// newlines, matching how the original textarea stored line breaks.
function serializeEditor(root) {
  let out = "";
  const walk = (node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        let t = child.nodeValue || "";
        t = t.replace(/\u00A0/g, " ");
        out += t;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (
          child.getAttribute &&
          child.getAttribute("data-mention-id") !== null
        ) {
          const id = child.getAttribute("data-mention-id") || "";
          const name = child.getAttribute("data-mention-name") || "";
          out += `@[${id}|${name}]`;
        } else if (child.tagName === "BR" || child.tagName === "DIV") {
          out += "\n";
          walk(child);
        } else {
          walk(child);
        }
      }
    });
  };
  walk(root);
  return out;
}

// Builds the editor DOM from a saved body string. `@[id|title]` tokens
// become atomic clickable spans if the target note still exists, or
// plain gray non-clickable text if the target has been deleted (per the
// spec's "deleted-note handling" requirement).
async function hydrateEditorFromBody(editor, body, buildMentionSpan) {
  editor.innerHTML = "";
  if (!body) return;

  const safeBody = stripOldWikilinkArtifact(body);
  const frag = document.createDocumentFragment();

  let last = 0;
  let m;
  MENTION_RE.lastIndex = 0;
  const tokens = [];
  while ((m = MENTION_RE.exec(safeBody)) !== null) {
    tokens.push({ id: m[1], name: m[2], index: m.index, length: m[0].length });
  }

  for (const tok of tokens) {
    if (tok.index > last) {
      frag.appendChild(
        document.createTextNode(safeBody.slice(last, tok.index)),
      );
    }
    // Resolve the target note. If it's gone, render as plain gray
    // non-clickable text — same place in the body, no span, no click
    // handler. We do the lookup outside this function (in buildMentionSpan
    // we'd need to be async), so do it inline here.
    const span = await resolveMentionNode(tok.id, tok.name, buildMentionSpan);
    frag.appendChild(span);
    last = tok.index + tok.length;
  }
  if (last < safeBody.length) {
    frag.appendChild(document.createTextNode(safeBody.slice(last)));
  }

  editor.appendChild(frag);
}

// Looks up a note by id; if it still exists, returns the clickable mention
// span; if it's been deleted, returns a styled-but-non-clickable <span>
// that stays in the body as the literal `@[id|title]` text so a future
// reload (if the note is restored, or in case of stale cache) still has
// the data to try again. Both branches render so the editor never has a
// dangling broken reference.
async function resolveMentionNode(noteId, name, buildMentionSpan) {
  let note;
  try {
    note = await getNoteById(noteId);
  } catch {
    note = undefined;
  }
  if (note) {
    return buildMentionSpan(note.id, note.title);
  }
  // Deleted target → gray non-clickable literal text.
  const span = document.createElement("span");
  span.className = "mention-token-ghost";
  span.textContent = `@${name || "deleted"}`;
  return span;
}

// Renders the body for the note-list preview. Mentions show as `@title`
// (readable) rather than the raw `@[id|title]` token.
function renderBodyPreview(body) {
  if (!body) return "";
  // First, strip the id portion of mention tokens so the list preview
  // shows "@Title" instead of "@[uuid|Title]".
  const cleaned = body.replace(MENTION_RE, (_, id, name) => `@${name}`);
  return cleaned.slice(0, 150);
}
