"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import {
  hasAnyFolders,
  getFoldersForDashboard,
  seedFoldersForProfile,
  createNote,
  createNotesFromTree,
  getNotesInFolder,
  getOrCreateQuickNotesFolder,
  saveEntities,
  retryPendingSync
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

export default function Dashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState([]);
  const [noteCounts, setNoteCounts] = useState({});
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState("work");

  const [capsuleState, setCapsuleState] = useState("collapsed");
  const [inputText, setInputText] = useState("");
  const [capsuleHeight, setCapsuleHeight] = useState(48);
  const [apiLoading, setApiLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const textareaRef = useRef(null);

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
          }
        } else {
          console.error("API failed to organize");
        }
      } catch (err) {
        console.error("AI Organize error:", err);
      } finally {
        setApiLoading(false);
        setCapsuleState("collapsed");
        setInputText("");
        setCapsuleHeight(48);
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
      <div className="flex min-h-screen items-center justify-center bg-bone">
        <p className="font-sans text-warm-gray animate-pulse">Loading MindCanvas...</p>
      </div>
    );
  }

  if (showOnboarding) {
    return (
      <div className="flex flex-col min-h-screen bg-bone items-center justify-center px-6">
        <h1 className="font-serif text-ink text-4xl text-center font-bold tracking-tight">
          What&apos;s on your mind?
        </h1>
        <p className="font-sans text-warm-gray text-base mt-2 text-center max-w-sm">
          Select a profile to seed your workspace with starter folders.
        </p>

        <div className="flex flex-col gap-3 mt-8 w-full max-w-xs">
          {["work", "personal", "study"].map((profile) => (
            <button
              key={profile}
              onClick={() => setSelectedProfile(profile)}
              className={`py-3 px-6 rounded-full border transition-all text-sm font-semibold capitalize font-sans ${
                selectedProfile === profile
                  ? "bg-ink border-ink text-bone"
                  : "bg-transparent border-warm-gray-light text-ink hover:bg-ink/5"
              }`}
            >
              {profile}
            </button>
          ))}
        </div>

        <button
          onClick={handleOnboarding}
          className="mt-12 bg-clay hover:bg-clay/90 text-bone rounded-full px-10 py-3.5 font-sans font-semibold shadow-md active:scale-[0.98] transition-all"
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

  const capsuleExpanded = capsuleState !== "collapsed";
  const capsuleRadius = capsuleHeight > 56 ? "24px" : "9999px";

  return (
    <div className="flex min-h-screen bg-bone">
      <Sidebar />

      <div className="relative min-h-screen flex-1 px-5 pt-8 pb-32 select-none lg:pl-5 pl-14">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-ink text-3xl font-bold">{getGreeting()}</h1>
            <p className="font-sans text-warm-gray text-xs font-semibold uppercase tracking-wider mt-1">
              Your spaces
            </p>
            {syncMessage && (
              <p className="font-sans text-warm-gray text-xs mt-2">{syncMessage}</p>
            )}
          </div>
          <button
            onClick={handleRetrySync}
            className="font-sans text-xs font-semibold text-pine hover:text-ink transition-colors"
          >
            Sync
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3 mt-6">
          {folders.map((folder) => {
            const noteCount = noteCounts[folder.id] || 0;

            if (folder.size === "hero") {
              return (
                <Link
                  key={folder.id}
                  href={`/folder/${folder.id}`}
                  className="col-span-2 relative overflow-hidden rounded-2xl p-5 block transition-all hover:scale-[1.01] active:scale-[0.99]"
                  style={{ backgroundColor: "#1C1912" }}
                >
                  <div
                    className="absolute top-0 right-0 w-3/5 h-3/5 pointer-events-none"
                    style={{
                      background: "radial-gradient(circle at top right, rgba(196, 87, 31, 0.18), transparent 70%)",
                    }}
                  />
                  <h2 className="font-serif text-bone text-2xl font-semibold relative z-10">
                    {folder.name}
                  </h2>
                  <p className="font-sans text-warm-gray-light text-sm mt-1 relative z-10">
                    {noteCount} {noteCount === 1 ? "note" : "notes"}
                  </p>
                  <div className="font-sans text-warm-gray text-xs mt-6 relative z-10">
                    Last active {getRelativeTimeString(folder.updatedAt)}
                  </div>
                </Link>
              );
            }

            if (folder.size === "med") {
              return (
                <Link
                  key={folder.id}
                  href={`/folder/${folder.id}`}
                  className="rounded-2xl p-4 bg-sage block transition-all hover:scale-[1.01] active:scale-[0.99]"
                >
                  <h2 className="font-serif text-ink text-lg font-bold">{folder.name}</h2>
                  <p className="font-sans text-warm-gray-dark text-sm mt-1">
                    {noteCount} {noteCount === 1 ? "note" : "notes"}
                  </p>
                </Link>
              );
            }

            if (folder.size === "tan") {
              return (
                <Link
                  key={folder.id}
                  href={`/folder/${folder.id}`}
                  className="rounded-2xl p-4 bg-tan block transition-all hover:scale-[1.01] active:scale-[0.99]"
                >
                  <h2 className="font-serif text-ink text-lg font-bold">{folder.name}</h2>
                  <p className="font-sans text-warm-gray-dark text-sm mt-1">
                    {noteCount} {noteCount === 1 ? "note" : "notes"}
                  </p>
                </Link>
              );
            }

            return (
              <Link
                key={folder.id}
                href={`/folder/${folder.id}`}
                className="rounded-2xl p-4 bg-bone border border-warm-gray-light/30 block transition-all hover:scale-[1.01] active:scale-[0.99]"
              >
                <h2 className="font-serif text-ink text-base font-bold">{folder.name}</h2>
                <p className="font-sans text-warm-gray text-sm mt-1">
                  {noteCount} {noteCount === 1 ? "note" : "notes"}
                </p>
              </Link>
            );
          })}
        </div>

        {capsuleState === "options" && (
          <div
            className="fixed inset-0 bg-ink/30 z-40 transition-opacity duration-200"
            onClick={() => setCapsuleState("input")}
          />
        )}

        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center lg:left-[calc(50%+120px)]">
          {capsuleState === "options" && (
            <div className="flex flex-col gap-2 items-center mb-3 animate-fade-in-up">
              {inputText.trim() && (
                <button
                  onClick={() => handleOptionSelect("ai-organize")}
                  disabled={apiLoading}
                  className="bg-ink text-bone font-sans text-sm font-semibold px-6 py-3 rounded-full cursor-pointer hover:bg-ink/90 active:scale-[0.97] transition-all whitespace-nowrap shadow-md disabled:opacity-50"
                >
                  {apiLoading ? "Organizing with AI..." : "Organize with AI"}
                </button>
              )}
              <button
                onClick={() => handleOptionSelect("new-note")}
                disabled={!inputText.trim()}
                className="bg-ink text-bone font-sans text-sm font-semibold px-6 py-3 rounded-full cursor-pointer hover:bg-ink/90 active:scale-[0.97] transition-all whitespace-nowrap shadow-md disabled:opacity-50"
              >
                New note
              </button>
              <button
                onClick={() => handleOptionSelect("second-brain")}
                className="bg-ink text-bone font-sans text-sm font-semibold px-6 py-3 rounded-full cursor-pointer hover:bg-ink/90 active:scale-[0.97] transition-all whitespace-nowrap shadow-md"
              >
                Second brain
              </button>
            </div>
          )}

          {!capsuleExpanded && (
            <button
              onClick={() => setCapsuleState("input")}
              className="w-16 h-9 bg-ink hover:bg-ink/90 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-[0.95]"
            >
              <div className="w-5 h-0.5 bg-warm-gray-light rounded-full" />
            </button>
          )}

          {capsuleExpanded && (
            <div
              className="bg-ink flex items-end gap-2 px-4 py-2 shadow-lg animate-expand-bounce"
              style={{
                width: "min(90vw, 400px)",
                minHeight: "48px",
                borderRadius: capsuleRadius,
              }}
            >
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Dump your thoughts..."
                rows={1}
                className="bg-transparent text-bone font-sans text-sm placeholder-warm-gray outline-none flex-1 border-none resize-none leading-relaxed py-1 max-h-[45vh] overflow-y-auto"
                style={{ height: `${capsuleHeight}px` }}
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
                className="w-8 h-8 rounded-full bg-clay hover:bg-clay/90 flex items-center justify-center shrink-0 mb-0.5 transition-transform active:scale-[0.9]"
              >
                <span className="text-bone font-bold text-lg select-none">→</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
