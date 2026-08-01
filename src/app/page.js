"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, FolderOpen, ChevronRight } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import {
  hasAnyFolders,
  getFoldersForDashboard,
  seedFoldersForProfile,
  createNote,
  createNotesFromTree,
  getNotesInFolder,
  getAllNotesWithFolders,
  getOrCreateQuickNotesFolder,
  saveEntities,
  retryPendingSync
} from "@/lib/db";

// sessionStorage keys for capsule input persistence across tab switches.
const CAPSULE_TEXT_KEY = "mindcanvas:capsule-text";

function getStoredCapsuleText() {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(CAPSULE_TEXT_KEY) || "";
  } catch {
    return "";
  }
}

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

export default function Dashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState([]);
  const [noteCounts, setNoteCounts] = useState({});
  const [recentNotes, setRecentNotes] = useState([]);
  const [showAllSpaces, setShowAllSpaces] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState("work");

  const [capsuleState, setCapsuleState] = useState("collapsed");
  // Height of the expanded capsule (in px). Initial 48 matches the pill
  // resting height used by every setCapsuleHeight(48) reset call below.
  // Measured live by resizeCapsule() whenever inputText or capsuleState
  // changes (see the effect below).
  const [capsuleHeight, setCapsuleHeight] = useState(48);
  // On mount, hydrate capsule text from sessionStorage (Phase 2c — preserve
  // typed text across reloads / tab switches). Clearing happens after
  // successful note submission, not here.
  const [inputText, setInputText] = useState(getStoredCapsuleText);
  const [apiLoading, setApiLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const textareaRef = useRef(null);
  const debounceTimerRef = useRef(null);

  // Debounced write to sessionStorage — 300ms after the user stops typing.
  // Per the spec, this is only for the capsule textarea, not note editor
  // content (which autosaves to Supabase via the folder page).
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      try {
        if (typeof window === "undefined") return;
        if (inputText.trim()) {
          window.sessionStorage.setItem(CAPSULE_TEXT_KEY, inputText);
        } else {
          window.sessionStorage.removeItem(CAPSULE_TEXT_KEY);
        }
      } catch {
        // ignore write failures
      }
    }, 300);

    // Immediate flush when the tab becomes hidden — bypasses the 300ms
    // debounce so the user's in-progress text is preserved even if they
    // switch tabs mid-keystroke. Fires on visibilitychange ONLY when
    // transitioning to "hidden" (not on return).
    const flushOnHide = () => {
      if (document.visibilityState === "hidden") {
        try {
          if (inputText.trim()) {
            window.sessionStorage.setItem(CAPSULE_TEXT_KEY, inputText);
          }
        } catch {
          // ignore
        }
      }
    };
    document.addEventListener("visibilitychange", flushOnHide);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      document.removeEventListener("visibilitychange", flushOnHide);
    };
  }, [inputText]);

  const loadData = async () => {
    try {
      const hasFolders = await hasAnyFolders();
      if (!hasFolders) {
        setShowOnboarding(true);
        setLoading(false);
        return;
      }
      setShowOnboarding(false);
      const fetchedFolders = await getFoldersForDashboard();
      setFolders(fetchedFolders);

      const counts = {};
      for (const folder of fetchedFolders) {
        const notes = await getNotesInFolder(folder.id);
        counts[folder.id] = notes.length;
      }
      setNoteCounts(counts);

      // Recent notes: newest 5 by updatedAt. Sourced from the same Dexie
      // helper the rest of the app uses (already user-scoped), sorted and
      // sliced here rather than adding a new Supabase query.
      const allNotes = await getAllNotesWithFolders();
      const recent = allNotes
        .slice()
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 5);
      setRecentNotes(recent);
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadData();
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  const resizeCapsule = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxPx = Math.floor(window.innerHeight * 0.45);
    const next = Math.min(Math.max(el.scrollHeight + 2, 24), maxPx);
    setCapsuleHeight(next);
    el.style.height = `${next}px`;
  }, []);

  useEffect(() => {
    if (capsuleState !== "collapsed") {
      resizeCapsule();
    }
  }, [inputText, capsuleState, resizeCapsule]);

  const handleOnboarding = async () => {
    setLoading(true);
    await seedFoldersForProfile(selectedProfile);
    await loadData();
  };

  const handleOptionSelect = async (action) => {
    if (action === "new-note") {
      const body = inputText.trim();
      if (!body) return;

      const quickNotesFolderId = await getOrCreateQuickNotesFolder();
      await createNote(quickNotesFolderId, "", body);
      // Clear persisted capsule text after successful submission (Phase 2c).
      try {
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem(CAPSULE_TEXT_KEY);
        }
      } catch {
        // ignore
      }
      setCapsuleState("collapsed");
      setInputText("");
      setCapsuleHeight(48);
      router.push(`/folder/${quickNotesFolderId}`);
      return;
    }

    if (folders.length === 0) return;
    const targetFolderId = folders[0].id;

    if (action === "second-brain") {
      setCapsuleState("collapsed");
      setInputText("");
      setCapsuleHeight(48);
      router.push("/graph");
    } else if (action === "ai-organize") {
      if (!inputText.trim()) return;
      setApiLoading(true);
      try {
        const res = await fetch("/api/organize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: inputText }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.tree) {
            await createNotesFromTree(targetFolderId, data.tree);
            if (Array.isArray(data.entities) && data.entities.length > 0) {
              await saveEntities(data.entities);
            }
            await loadData();
            // AI-organized output consumed the capsule text — clear persistence.
            try {
              if (typeof window !== "undefined") {
                window.sessionStorage.removeItem(CAPSULE_TEXT_KEY);
              }
            } catch {
              // ignore
            }
            setCapsuleState("collapsed");
            setInputText("");
            setCapsuleHeight(48);
          }
        } else {
          console.error("API failed to organize");
        }
      } catch (err) {
        console.error("AI Organize error:", err);
      } finally {
        setApiLoading(false);
      }
    }
  };

  const handleRetrySync = async () => {
    setSyncMessage("Syncing...");
    try {
      await retryPendingSync();
      setSyncMessage("Sync complete");
      setTimeout(() => setSyncMessage(""), 2500);
    } catch (err) {
      console.error("Manual sync failed:", err);
      setSyncMessage("Still offline");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <p className="animate-pulse text-[14px]" style={{ color: "var(--text-dim)" }}>Loading MindCanvas…</p>
      </div>
    );
  }

  if (showOnboarding) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6" style={{ background: "var(--bg-primary)" }}>
        <h1 className="mc-display text-center text-[34px]" style={{ color: "var(--text-strong)" }}>
          What&apos;s on your mind?
        </h1>
        <p className="mt-2 max-w-sm text-center text-[14px]" style={{ color: "var(--text-dim)" }}>
          Select a profile to seed your workspace with starter folders.
        </p>

        <div className="flex flex-col gap-3 mt-8 w-full max-w-xs">
          {["work", "personal", "study"].map((profile) => (
            <button
              key={profile}
              onClick={() => setSelectedProfile(profile)}
              className={`rounded-full border px-6 py-3 text-[14px] font-medium capitalize transition-all ${
                selectedProfile === profile
                  ? "border-[#121212] bg-[#121212] text-white"
                  : "border-[#E9E6E1] bg-transparent text-[#121212] hover:bg-[#F5F3EF]"
              }`}
            >
              {profile}
            </button>
          ))}
        </div>

        <button
          onClick={handleOnboarding}
          className="mc-btn-primary mt-12 px-10 py-3.5 shadow-md active:scale-[0.98]"
        >
          Get started
        </button>
      </div>
    );
  }

  const getGreeting = () => {
    const hr = new Date().getHours();
    if (hr < 12) return "Good morning";
    if (hr < 18) return "Good afternoon";
    return "Good evening";
  };

  // Hero = most recently active space; the grid shows the next 6 unless
  // the user has expanded to all. getFoldersForDashboard already returns
  // folders sorted by updatedAt descending.
  const hero = folders[0] || null;
  const gridSpaces = showAllSpaces ? folders.slice(1) : folders.slice(1, 7);
  const hasMoreSpaces = folders.length > 7;
  const totalNotes = Object.values(noteCounts).reduce((sum, n) => sum + n, 0);

  const capsuleExpanded = capsuleState !== "collapsed";
  const capsuleRadius = capsuleHeight > 56 ? "22px" : "9999px";

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <Sidebar />

      <div className="relative mx-auto min-h-screen w-full max-w-[1000px] flex-1 select-none p-5 pb-40 lg:p-8 lg:pb-32">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1
              className="mc-display text-[26px] leading-tight lg:text-[28px]"
              style={{ color: "var(--text-strong)" }}
            >
              {getGreeting()}
            </h1>
            <p className="mt-1 text-[13.5px]" style={{ color: "var(--text-dim)" }}>
              You have {totalNotes} {totalNotes === 1 ? "note" : "notes"} across{" "}
              {folders.length} {folders.length === 1 ? "space" : "spaces"}
            </p>
            {syncMessage && (
              <p className="mt-2 text-[12px]" style={{ color: "var(--text-dim)" }}>
                {syncMessage}
              </p>
            )}
          </div>
          <button onClick={handleRetrySync} className="mc-btn-secondary">
            Sync
          </button>
        </header>

        {/* ---------------------------- HERO SPACE ---------------------------- */}
        {hero && (
          <div
            className="stagger-item mb-8 bg-white p-6"
            style={{
              borderRadius: "var(--radius-card)",
              border: "1px solid var(--border-1)",
              boxShadow: "0 2px 12px rgba(0, 0, 0, 0.04)",
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div
                className="flex items-center gap-2 text-[12px]"
                style={{ color: "var(--text-dim)" }}
              >
                <span className="mc-space-icon h-7 w-7">
                  <FolderOpen size={16} strokeWidth={1.8} />
                </span>
                <span>
                  {(noteCounts[hero.id] || 0)}{" "}
                  {(noteCounts[hero.id] || 0) === 1 ? "note" : "notes"}
                </span>
                <span
                  className="h-1 w-1 rounded-full"
                  style={{ background: "var(--border-1)" }}
                />
                <span>Last edited {getRelativeTimeString(hero.updatedAt)}</span>
              </div>
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: "var(--accent-green)" }}
              />
            </div>

            <h2
              className="mc-display text-[22px] leading-tight"
              style={{ color: "var(--text-strong)" }}
            >
              {hero.name}
            </h2>

            <Link
              href={`/folder/${hero.id}`}
              className="mc-link mt-5 inline-block"
            >
              Open space &rarr;
            </Link>
          </div>
        )}

        {/* ---------------------------- SPACES GRID --------------------------- */}
        {gridSpaces.length > 0 && (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="mc-section-label">YOUR SPACES</h3>
              {hasMoreSpaces && (
                <button
                  type="button"
                  onClick={() => setShowAllSpaces((v) => !v)}
                  className="mc-link"
                >
                  {showAllSpaces ? "Show fewer" : "View all spaces"}
                </button>
              )}
            </div>

            <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-3">
              {gridSpaces.map((folder, idx) => {
                const noteCount = noteCounts[folder.id] || 0;
                return (
                  <Link
                    key={folder.id}
                    href={`/folder/${folder.id}`}
                    className="stagger-item folder-card mc-card block"
                    style={{ animationDelay: `${idx * 40}ms` }}
                  >
                    <span className="mc-space-icon">
                      <FolderOpen size={16} strokeWidth={1.8} />
                    </span>
                    <div className="mc-space-name mt-3">{folder.name}</div>
                    <div className="mc-space-meta">
                      {noteCount} {noteCount === 1 ? "note" : "notes"}
                      {folder.updatedAt
                        ? ` • ${getRelativeTimeString(folder.updatedAt)}`
                        : ""}
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}

        {/* ---------------------------- RECENT NOTES -------------------------- */}
        {recentNotes.length > 0 && (
          <section>
            <h3 className="mc-section-label mb-3">RECENT NOTES</h3>
            <div className="mc-list-card">
              {recentNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() =>
                    router.push(`/folder/${note.folderId}?note=${note.id}`)
                  }
                  className="mc-row"
                >
                  <span className="min-w-0">
                    <span className="mc-row-title block truncate pr-3">
                      {note.title || "Untitled"}
                    </span>
                    <span className="mc-row-meta block">
                      {note.folderName} • {getRelativeTimeString(note.updatedAt)}
                    </span>
                  </span>
                  <ChevronRight
                    size={16}
                    strokeWidth={1.8}
                    style={{ color: "var(--text-dim)" }}
                    className="shrink-0"
                  />
                </button>
              ))}
            </div>
          </section>
        )}

        {capsuleState === "options" && (
          <div
            className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-200"
            onClick={() => setCapsuleState("input")}
          />
        )}

        {/* Desktop capture pill. On mobile the sage FAB in the nav shell is
            the capture affordance (matching the two mockups), so this is
            hidden below lg to avoid two competing capture controls. */}
        <div className="fixed bottom-6 left-1/2 z-50 hidden -translate-x-1/2 flex-col items-center lg:left-[calc(50%+140px)] lg:flex">
          {capsuleState === "options" && (
            <div className="flex flex-col gap-2 items-center mb-3">
              {(() => {
                // Build the visible options list first so we can stagger
                // them with a flat 30ms index regardless of which are shown.
                const opts = [];
                let idx = 0;
                if (inputText.trim()) {
                  opts.push(
                    <button
                      key="ai-organize"
                      onClick={() => handleOptionSelect("ai-organize")}
                      disabled={apiLoading}
                      className="option-item mc-btn-primary whitespace-nowrap px-6 py-3 shadow-md disabled:opacity-50"
                      style={{ animationDelay: `${idx++ * 30}ms` }}
                    >
                      {apiLoading ? "Organizing with AI..." : "Organize with AI"}
                    </button>
                  );
                }
                opts.push(
                  <button
                    key="new-note"
                    onClick={() => handleOptionSelect("new-note")}
                    disabled={!inputText.trim()}
                    className="option-item mc-btn-primary whitespace-nowrap px-6 py-3 shadow-md disabled:opacity-50"
                    style={{ animationDelay: `${idx++ * 30}ms` }}
                  >
                    New note
                  </button>
                );
                opts.push(
                  <button
                    key="second-brain"
                    onClick={() => handleOptionSelect("second-brain")}
                    className="option-item mc-btn-secondary whitespace-nowrap px-6 py-3 shadow-md"
                    style={{ animationDelay: `${idx++ * 30}ms` }}
                  >
                    Second brain
                  </button>
                );
                return opts;
              })()}
            </div>
          )}

          {!capsuleExpanded && (
            <button
              onClick={() => setCapsuleState("input")}
              className="flex h-9 w-16 items-center justify-center rounded-full border transition-all active:scale-[0.95]" style={{ background: "var(--card-bg)", borderColor: "var(--border-1)", boxShadow: "var(--shadow-capture)" }}
            >
              <div className="h-0.5 w-5 rounded-full" style={{ background: "var(--text-dim-2)" }} />
            </button>
          )}

          {capsuleExpanded && (
            <div
              className="flex items-end gap-2 border px-4 py-2 animate-expand-bounce"
              style={{
                width: "min(90vw, 400px)",
                minHeight: "56px",
                background: "var(--card-bg)",
                borderColor: "var(--border-1)",
                boxShadow: "var(--shadow-capture)",
                maxHeight: "45vh",
                borderRadius: capsuleRadius,
                transition: "border-radius 200ms ease, height 200ms ease, max-height 200ms ease",
              }}
            >
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Dump your thoughts..."
                rows={1}
                className="themed-placeholder max-h-[45vh] flex-1 resize-none overflow-y-auto border-none bg-transparent py-1 text-[14px] leading-relaxed outline-none"
                style={{ height: `${capsuleHeight}px`, color: "var(--text-strong)" }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && inputText.trim()) {
                    e.preventDefault();
                    setCapsuleState("options");
                  }
                }}
              />
              <button
                onClick={() => setCapsuleState("options")}
                className="mc-fab mb-0.5 h-9 w-9 shrink-0 transition-transform active:scale-[0.9]" style={{ boxShadow: "none" }}
              >
                <ArrowUp size={18} strokeWidth={1.8} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
