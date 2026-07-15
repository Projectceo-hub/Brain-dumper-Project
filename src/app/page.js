"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  hasAnyFolders,
  getFoldersForDashboard,
  seedFoldersForProfile,
  createNote,
  createNotesFromTree,
  getNotesInFolder
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

  // Capsule state: 'collapsed' | 'input' | 'options'
  const [capsuleState, setCapsuleState] = useState("collapsed");
  const [inputText, setInputText] = useState("");
  const [apiLoading, setApiLoading] = useState(false);

  // Load folders
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

      // Fetch note counts
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
    loadData();
  }, []);

  const handleOnboarding = async () => {
    setLoading(true);
    await seedFoldersForProfile(selectedProfile);
    await loadData();
  };

  const handleOptionSelect = async (action) => {
    if (folders.length === 0) return;
    const targetFolderId = folders[0].id; // Most recently updated folder

    if (action === "new-note") {
      const noteId = await createNote(targetFolderId, "", "");
      setCapsuleState("collapsed");
      setInputText("");
      router.push(`/folder/${targetFolderId}`);
    } else if (action === "second-brain") {
      setCapsuleState("collapsed");
      setInputText("");
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
          if (data && data.tree) {
            await createNotesFromTree(targetFolderId, data.tree);
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
      }
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bone">
        <p className="font-sans text-warm-gray animate-pulse">Loading MindCanvas...</p>
      </div>
    );
  }

  // 1. ONBOARDING GATE
  if (showOnboarding) {
    return (
      <div className="flex flex-col min-h-screen bg-bone items-center justify-center px-6">
        <h1 className="font-serif text-ink text-4xl text-center font-bold tracking-tight">
          What's on your mind?
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

  // 2. MAIN DASHBOARD
  const getGreeting = () => {
    const hr = new Date().getHours();
    if (hr < 12) return "Good morning";
    if (hr < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <div className="min-h-screen bg-bone px-5 pt-8 pb-32 relative select-none">
      {/* Header */}
      <header className="mb-6">
        <h1 className="font-serif text-ink text-3xl font-bold">{getGreeting()}</h1>
        <p className="font-sans text-warm-gray text-xs font-semibold uppercase tracking-wider mt-1">
          Your spaces
        </p>
      </header>

      {/* Asymmetric Folder Grid */}
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
                {/* Radial Glow Accent */}
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
                <h2 className="font-serif text-ink text-lg font-bold">
                  {folder.name}
                </h2>
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
                <h2 className="font-serif text-ink text-lg font-bold">
                  {folder.name}
                </h2>
                <p className="font-sans text-warm-gray-dark text-sm mt-1">
                  {noteCount} {noteCount === 1 ? "note" : "notes"}
                </p>
              </Link>
            );
          }

          // Default
          return (
            <Link
              key={folder.id}
              href={`/folder/${folder.id}`}
              className="rounded-2xl p-4 bg-bone border border-warm-gray-light/30 block transition-all hover:scale-[1.01] active:scale-[0.99]"
            >
              <h2 className="font-serif text-ink text-base font-bold">
                {folder.name}
              </h2>
              <p className="font-sans text-warm-gray text-sm mt-1">
                {noteCount} {noteCount === 1 ? "note" : "notes"}
              </p>
            </Link>
          );
        })}
      </div>

      {/* Scrim when options menu is open */}
      {capsuleState === "options" && (
        <div
          className="fixed inset-0 bg-ink/30 z-40 transition-opacity duration-200"
          onClick={() => setCapsuleState("collapsed")}
        />
      )}

      {/* Floating Capsule & Menus */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center">
        {/* Options Above Capsule */}
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
              className="bg-ink text-bone font-sans text-sm font-semibold px-6 py-3 rounded-full cursor-pointer hover:bg-ink/90 active:scale-[0.97] transition-all whitespace-nowrap shadow-md"
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

        {/* Collapsed Capsule */}
        {capsuleState === "collapsed" && (
          <button
            onClick={() => setCapsuleState("input")}
            className="w-16 h-9 bg-ink hover:bg-ink/90 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-[0.95]"
          >
            <div className="w-5 h-0.5 bg-warm-gray-light rounded-full" />
          </button>
        )}

        {/* Expanded Input Capsule */}
        {capsuleState !== "collapsed" && (
          <div
            className="bg-ink rounded-full flex items-center gap-2 px-4 shadow-lg animate-expand-bounce"
            style={{
              width: "min(90vw, 400px)",
              height: "48px",
            }}
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Dump your thoughts..."
              className="bg-transparent text-bone font-sans text-sm placeholder-warm-gray outline-none flex-1 border-none"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && inputText.trim()) {
                  setCapsuleState("options");
                }
              }}
            />
            <button
              onClick={() => setCapsuleState("options")}
              className="w-8 h-8 rounded-full bg-clay hover:bg-clay/90 flex items-center justify-center shrink-0 transition-transform active:scale-[0.9]"
            >
              <span className="text-bone font-bold text-lg select-none">→</span>
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
