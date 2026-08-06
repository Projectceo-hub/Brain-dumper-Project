"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { getBacklinks } from "@/lib/db";

// Phase 11 — "N notes mention this", rendered under the open note.
//
// Source of truth is /api/backlinks, with the local Dexie mirror as a
// fallback so the panel still works offline. The mirror is also the only
// place a link exists between being created and being synced, so a fallback
// is not merely an offline nicety.
export default function BacklinksPanel({ noteId, onSelectNote }) {
  // Results are stored together with the note they were fetched for. That
  // keeps the "which note is this about?" check derivable at render time
  // instead of needing an effect to clear stale rows — which would both
  // trip react-hooks/set-state-in-effect and briefly show the previous
  // note's backlinks when switching notes.
  const [fetched, setFetched] = useState({ noteId: null, rows: [] });
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!noteId) return;

    let cancelled = false;

    (async () => {
      let rows = [];
      try {
        const res = await fetch(
          `/api/backlinks?noteId=${encodeURIComponent(noteId)}`,
        );
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          rows = Array.isArray(data.backlinks) ? data.backlinks : [];
        }
      } catch {
        rows = [];
      }

      if (rows.length === 0) {
        try {
          rows = await getBacklinks(noteId);
        } catch {
          rows = [];
        }
      }

      if (!cancelled) setFetched({ noteId, rows });
    })();

    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const backlinks = fetched.noteId === noteId ? fetched.rows : [];

  // No backlinks means no panel at all — never an empty placeholder.
  if (backlinks.length === 0) return null;

  return (
    <section
      className="mt-10 pt-6"
      style={{ borderTop: "1px solid var(--border-1)" }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <span
          className="text-[12px] font-medium"
          style={{ color: "var(--text-dim)" }}
        >
          {backlinks.length} {backlinks.length === 1 ? "note" : "notes"} mention
          this
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          style={{ color: "var(--text-dim)" }}
          className={`transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-1">
          {backlinks.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => onSelectNote?.(link.id)}
              className="mc-backlink-row"
            >
              <span
                className="block truncate text-[13.5px] font-medium"
                style={{ color: "var(--text-strong)" }}
              >
                {link.title || "Untitled"}
              </span>
              {link.snippet && (
                <span
                  className="mt-0.5 block truncate text-[12px]"
                  style={{ color: "var(--text-dim)" }}
                >
                  {link.snippet}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
