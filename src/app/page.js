"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";
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

  const capsuleExpanded = capsuleState !== "collapsed";
  const capsuleRadius = capsuleHeight > 56 ? "22px" : "9999px";

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <Sidebar />

      <div className="relative min-h-screen flex-1 select-none px-5 pt-6 pb-40 lg:px-8 lg:pt-8 lg:pb-32">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1
              className="mc-display text-[28px] lg:text-[32px]"
              style={{ color: "var(--text-strong)" }}
            >
              {getGreeting()}
            </h1>
            <p
              className="mt-1 text-[11px] font-medium uppercase tracking-[0.08em]"
              style={{ color: "var(--text-dim)" }}
            >
              Your spaces
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
          <Link
            href={`/folder/${hero.id}`}
            className="stagger-item folder-card relative block overflow-hidden p-5"
            style={{
              minHeight: "160px",
              backgroundColor: "var(--dark-surface)",
              borderRadius: "var(--radius-card)",
            }}
          >
            <div
              className="pointer-events-none absolute top-0 right-0 h-3/5 w-3/5"
              style={{
                background:
                  "radial-gradient(circle at top right, rgba(122, 142, 93, 0.15), transparent 70%)",
              }}
            />
            <h2 className="mc-display relative z-10 text-[28px] text-white">
              {hero.name}
            </h2>
            <p className="relative z-10 mt-1 text-[13px] text-white/60">
              {(noteCounts[hero.id] || 0)}{" "}
              {(noteCounts[hero.id] || 0) === 1 ? "note" : "notes"}
            </p>
            <div className="relative z-10 mt-6 text-[11px] uppercase tracking-widest text-white/50">
              Last active {getRelativeTimeString(hero.updatedAt)}
            </div>
          </Link>
        )}

        {/* ---------------------------- SPACES GRID --------------------------- */}
        {gridSpaces.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {gridSpaces.map((folder, idx) => {
              const noteCount = noteCounts[folder.id] || 0;
              return (
                <Link
                  key={folder.id}
                  href={`/folder/${folder.id}`}
                  className="stagger-item folder-card mc-card block"
                  style={{ animationDelay: `${idx * 40}ms`, padding: "20px" }}
                >
                  <h2 className="mc-card-title">{folder.name}</h2>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--text-dim)" }}>
                    {noteCount} {noteCount === 1 ? "note" : "notes"}
                    {folder.updatedAt ? ` · ${getRelativeTimeString(folder.updatedAt)}` : ""}
                  </p>
                </Link>
              );
            })}
          </div>
        )}

        {hasMoreSpaces && !showAllSpaces && (
          <button
            type="button"
            onClick={() => setShowAllSpaces(true)}
            className="mt-4 text-[12px]"
            style={{ color: "var(--accent-green)" }}
          >
            View all spaces &rarr;
          </button>
        )}

        {/* ---------------------------- RECENT NOTES -------------------------- */}
        {recentNotes.length > 0 && (
          <section className="mt-10">
            <h2
              className="text-[11px] uppercase tracking-widest"
              style={{ color: "var(--text-dim)" }}
            >
              Recent
            </h2>
            <div className="mt-3">
              {recentNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() =>
                    router.push(`/folder/${note.folderId}?note=${note.id}`)
                  }
                  className="flex w-full items-center justify-between gap-4 py-3 text-left"
                  style={{ borderBottom: "1px solid var(--border-1)" }}
                >
                  <span
                    className="min-w-0 flex-1 truncate text-[14px]"
                    style={{ color: "var(--text-strong)" }}
                  >
                    {note.title || "Untitled"}
                  </span>
                  <span
                    className="shrink-0 text-[11px]"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {note.folderName} &middot; {getRelativeTimeString(note.updatedAt)}
                  </span>
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
