"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, ChevronRight, X } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import {
  hasAnyFolders,
  getFoldersForDashboard,
  seedFoldersForProfile,
  getNotesInFolder,
  getAllNotesWithFolders,
  retryPendingSync,
  getAllNoteLinks
} from "@/lib/db";


// ---------------------------------------------------------------------------
// Daily digest
// ---------------------------------------------------------------------------
// Dismissal is remembered for 24 hours, then the card comes back.
const DIGEST_DISMISSED_KEY = "mindcanvas:digest-dismissed-at";
const DIGEST_DISMISS_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isDigestDismissed() {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DIGEST_DISMISSED_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < DIGEST_DISMISS_MS;
  } catch {
    return false;
  }
}

// Builds at most 3 digest items from data already in Dexie. Every item is
// derived from a real field — there are no scores or invented metrics.
//
//   a) UNFINISHED — touched in the last 7 days, body under 100 chars
//   b) REVISIT    — a substantive note (>=100 chars) untouched for 7+ days
//   c) FOLLOW UP  — a note mentioned by 3 or more *different* notes
//
// One item per category is preferred so the card reads as a summary rather
// than a list of near-duplicates.
function buildDigestItems(allNotes, noteLinks) {
  const now = Date.now();
  const items = [];
  const ts = (n) => new Date(n.updatedAt).getTime() || 0;

  const recent = allNotes
    .filter((n) => now - ts(n) < SEVEN_DAYS_MS)
    .filter((n) => (n.body || "").trim().length < 100)
    .sort((a, b) => ts(b) - ts(a));
  if (recent[0]) {
    items.push({
      key: `unfinished-${recent[0].id}`,
      label: "Unfinished",
      title: recent[0].title || "Untitled",
      spaceName: recent[0].folderName,
      noteId: recent[0].id,
      folderId: recent[0].folderId,
    });
  }

  const stale = allNotes
    .filter((n) => now - ts(n) >= SEVEN_DAYS_MS)
    .filter((n) => (n.body || "").trim().length >= 100)
    .sort((a, b) => ts(b) - ts(a));
  if (stale[0]) {
    items.push({
      key: `revisit-${stale[0].id}`,
      label: "Revisit",
      title: stale[0].title || "Untitled",
      spaceName: stale[0].folderName,
      noteId: stale[0].id,
      folderId: stale[0].folderId,
    });
  }

  // Count how many DISTINCT notes mention each target.
  const mentionSources = new Map();
  for (const link of noteLinks || []) {
    if (!link?.target_note_id || !link?.source_note_id) continue;
    const t = String(link.target_note_id);
    if (!mentionSources.has(t)) mentionSources.set(t, new Set());
    mentionSources.get(t).add(String(link.source_note_id));
  }
  const hot = [...mentionSources.entries()]
    .filter(([, sources]) => sources.size >= 3)
    .sort((a, b) => b[1].size - a[1].size);
  for (const [targetId] of hot) {
    const note = allNotes.find((n) => String(n.id) === targetId);
    if (!note) continue;
    items.push({
      key: `followup-${note.id}`,
      label: "Follow up",
      title: note.title || "Untitled",
      spaceName: note.folderName,
      noteId: note.id,
      folderId: note.folderId,
    });
    break;
  }

  return items.slice(0, 3);
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
  const [digestItems, setDigestItems] = useState([]);
  const [digestDismissed, setDigestDismissed] = useState(isDigestDismissed);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState("work");

  const [syncMessage, setSyncMessage] = useState("");

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

      // Digest reuses the notes already fetched above plus the locally
      // cached note_links — no additional Supabase traffic.
      let links = [];
      try {
        links = await getAllNoteLinks();
      } catch {
        links = [];
      }
      setDigestItems(buildDigestItems(allNotes, links));
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

  const handleDismissDigest = () => {
    setDigestDismissed(true);
    try {
      window.localStorage.setItem(DIGEST_DISMISSED_KEY, String(Date.now()));
    } catch {
      // Non-fatal: the card simply reappears on the next load.
    }
  };

  const handleOnboarding = async () => {
    setLoading(true);
    await seedFoldersForProfile(selectedProfile);
    await loadData();
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

        {/* ---------------------------- DAILY DIGEST -------------------------- */}
        {/* Rendered only when there is something real to surface, so it never
            appears as an empty placeholder card. */}
        {!digestDismissed && digestItems.length > 0 && (
          <div
            className="stagger-item mb-4 p-6"
            style={{
              background: "var(--card-bg)",
              borderRadius: "var(--radius-card)",
              border: "1px solid var(--border-1)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2
                className="mc-display text-[20px] leading-tight"
                style={{ color: "var(--text-strong)" }}
              >
                Today for you
              </h2>
              <button
                type="button"
                onClick={handleDismissDigest}
                aria-label="Dismiss digest"
                className="shrink-0 transition-colors"
                style={{ color: "var(--text-dim)" }}
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {digestItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() =>
                    router.push(`/folder/${item.folderId}?note=${item.noteId}`)
                  }
                  className="flex w-full items-baseline gap-3 text-left"
                >
                  <span
                    className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: "var(--accent-green)" }}
                  >
                    {item.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[14px]"
                      style={{ color: "var(--text-strong)" }}
                    >
                      {item.title}
                    </span>
                  </span>
                  <span
                    className="shrink-0 text-[11px]"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {item.spaceName}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ---------------------------- HERO SPACE ---------------------------- */}
        {hero && (
          <div
            className="stagger-item mb-8 p-6"
            style={{
              background: "var(--card-bg)",
              borderRadius: "var(--radius-card)",
              border: "1px solid var(--border-1)",
              boxShadow: "var(--shadow-card)",
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
      </div>
    </div>
  );
}
