"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Phase 11 — global note search (Cmd/Ctrl+K).
//
// Two exports:
//   GlobalSearch      the overlay, driven entirely by props (per spec)
//   GlobalSearchHost  owns open state, the keyboard shortcut and navigation
//
// The host exists because the shortcut and the sidebar's Search button have
// to work on every route, so the overlay is mounted in layout.js — which is a
// server component and cannot hold state or use a router.
const OPEN_EVENT = "mindcanvas:open-search";
const DEBOUNCE_MS = 200;
const MIN_QUERY_CHARS = 2;

function SearchIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

// Rendered in the sidebar nav list, styled by .mc-nav-item like its siblings.
export function SearchTrigger({ onNavigate }) {
  return (
    <button
      type="button"
      className="mc-nav-item"
      onClick={() => {
        onNavigate?.();
        window.dispatchEvent(new CustomEvent(OPEN_EVENT));
      }}
    >
      <SearchIcon />
      Search
    </button>
  );
}

// Mount/unmount is the reset mechanism. An earlier version kept the overlay
// mounted and cleared its state in an effect when isOpen flipped, which is
// exactly the cascading-render pattern react-hooks/set-state-in-effect flags.
export default function GlobalSearch({ isOpen, onClose, onSelectNote }) {
  if (!isOpen) return null;
  return <SearchOverlay onClose={onClose} onSelectNote={onSelectNote} />;
}

function SearchOverlay({ onClose, onSelectNote }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  // Which query the current `results` belong to. Comparing this against the
  // live input tells us whether results are fresh WITHOUT having to clear
  // state from an effect body.
  const [resultsFor, setResultsFor] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const trimmed = query.trim();
  const tooShort = trimmed.length < MIN_QUERY_CHARS;

  // Debounced fetch. Every setState happens inside the timer callback rather
  // than in the effect body, so no synchronous cascade is triggered. The
  // cleanup cancels the timer and marks any in-flight request stale, so a
  // slow response for an old query cannot overwrite a newer one.
  useEffect(() => {
    if (tooShort) return;

    let stale = false;
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed }),
        });
        const data = await res.json().catch(() => ({}));
        if (stale) return;
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        if (!stale) setResults([]);
      } finally {
        if (!stale) {
          setResultsFor(trimmed);
          setIsLoading(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [trimmed, tooShort]);

  // Derived rather than stored: results only count as current when they were
  // fetched for exactly the text now in the box.
  const isCurrent = resultsFor === trimmed;
  const visibleResults = !tooShort && isCurrent ? results : [];
  const showEmptyPrompt = tooShort;
  const showSearching = !tooShort && (isLoading || !isCurrent);
  const showNoResults = !tooShort && !showSearching && visibleResults.length === 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-xl overflow-hidden rounded-2xl shadow-2xl"
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border-1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your notes..."
          className="themed-placeholder w-full bg-transparent outline-none"
          style={{
            border: "none",
            padding: "20px 24px",
            fontSize: "16px",
            color: "var(--text-primary)",
          }}
        />

        <div style={{ borderTop: "1px solid var(--border-1)" }} />

        <div className="max-h-[420px] overflow-y-auto">
          {showSearching && (
            <p
              className="text-center text-[13px]"
              style={{ padding: "24px", color: "var(--text-muted)" }}
            >
              Searching...
            </p>
          )}

          {showEmptyPrompt && (
            <p
              className="text-center text-[13px]"
              style={{ padding: "24px", color: "var(--text-muted)" }}
            >
              Start typing to search your notes
            </p>
          )}

          {showNoResults && (
            <p
              className="text-center text-[13px]"
              style={{ padding: "24px", color: "var(--text-muted)" }}
            >
              No notes found for &ldquo;{trimmed}&rdquo;
            </p>
          )}

          {visibleResults.map((result) => (
              <button
                key={result.id}
                type="button"
                onClick={() => {
                  onSelectNote?.(result);
                  onClose?.();
                }}
                className="mc-search-row block w-full text-left"
                style={{ padding: "12px 24px" }}
              >
                <span
                  className="block truncate text-[14px]"
                  style={{ fontWeight: 500, color: "var(--text-primary)" }}
                >
                  {result.title || "Untitled"}
                </span>
                {result.snippet && (
                  <span
                    className="mt-0.5 block truncate text-[13px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {result.snippet}
                  </span>
                )}
                {result.folder_name && (
                  <span
                    className="mt-1.5 inline-block text-[11px]"
                    style={{
                      background:
                        "color-mix(in srgb, var(--accent) 15%, transparent)",
                      color: "var(--accent)",
                      padding: "2px 8px",
                      borderRadius: "999px",
                    }}
                  >
                    {result.folder_name}
                  </span>
                )}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

export function GlobalSearchHost() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    const handleKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setIsOpen(true);
      }
    };
    window.addEventListener(OPEN_EVENT, handleOpen);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, handleOpen);
      window.removeEventListener("keydown", handleKey);
    };
  }, []);

  const handleSelectNote = useCallback(
    (result) => {
      if (!result?.id) return;
      // Notes are only reachable through their folder route, which is why the
      // search API returns folder_id alongside the note.
      if (result.folder_id) {
        router.push(`/folder/${result.folder_id}?note=${result.id}`, {
          scroll: false,
        });
      }
    },
    [router],
  );

  return (
    <GlobalSearch
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      onSelectNote={handleSelectNote}
    />
  );
}
