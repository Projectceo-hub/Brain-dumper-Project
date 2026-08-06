"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Layers,
  Network,
  Plus,
  Download,
  Settings as SettingsIcon,
  LogOut,
  ChevronDown,
  Loader2,
} from "lucide-react";
import {
  getAllFolders,
  getNotesInFolder,
  createFolder,
  createNote,
  getOrCreateQuickNotesFolder,
} from "@/lib/db";
import { createClient } from "@/lib/supabase/client";
import { AskAiTrigger } from "@/components/NoteChat";
import { SearchTrigger } from "@/components/GlobalSearch";

// Phase 7B navigation shell.
//
// Presentation follows the approved mockups:
//   - desktop: 280px #121212 sidebar, full-round nav pills, green
//     "New Thought" button, Spaces section, footer utilities
//   - mobile:  72px translucent bottom nav (Home/Spaces/Graph/Chat/You)
//     plus the sage-green floating capture button
//
// All data behaviour (folders, note counts, profile, online state, export,
// new space, logout) is carried over from the pre-7B sidebar unchanged.

// lucide default stroke is 2; the 7B spec calls for 1.8 everywhere.
const ICON = { size: 18, strokeWidth: 1.8 };
const NAV_ICON = { size: 20, strokeWidth: 1.8 };

export default function Sidebar({ activeFolderId = null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [folders, setFolders] = useState([]);
  const [noteCounts, setNoteCounts] = useState({});
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [spacesOpen, setSpacesOpen] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  const loadSidebar = useCallback(async () => {
    const folderList = await getAllFolders();
    setFolders(folderList);

    const counts = {};
    for (const folder of folderList) {
      const notes = await getNotesInFolder(folder.id);
      counts[folder.id] = notes.length;
    }
    setNoteCounts(counts);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const folderList = await getAllFolders();
      if (cancelled) return;
      setFolders(folderList);

      const counts = {};
      for (const folder of folderList) {
        const notes = await getNotesInFolder(folder.id);
        if (cancelled) return;
        counts[folder.id] = notes.length;
      }
      if (!cancelled) setNoteCounts(counts);
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email || "");
      setDisplayName(data.user?.user_metadata?.display_name || "");
    });

    const refresh = () => {
      supabase.auth.getUser().then(({ data }) => {
        setEmail(data.user?.email || "");
        setDisplayName(data.user?.user_metadata?.display_name || "");
      });
    };
    window.addEventListener("mindcanvas:profile-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("mindcanvas:profile-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleExportVault = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const res = await fetch("/api/export", { method: "POST" });
      if (res.status === 401) {
        setExportError("Please log in to export.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setExportError(body?.error || "Export failed.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `mindcanvas-vault-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err?.message || "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const handleNewSpace = async () => {
    const name = window.prompt("Name your new space:");
    if (!name?.trim()) return;
    setCreating(true);
    try {
      await createFolder(name.trim());
      await loadSidebar();
    } finally {
      setCreating(false);
    }
  };

  // Floating capture button / "New Thought": drops a blank note into the
  // Quick notes space and opens it straight in the editor.
  const handleCapture = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const folderId = await getOrCreateQuickNotesFolder();
      const noteId = await createNote(folderId, "", "");
      setMobileOpen(false);
      router.push(`/folder/${folderId}?note=${noteId}`);
    } catch (err) {
      console.warn("Capture failed:", err);
    } finally {
      setCapturing(false);
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
  };

  const isGraph = pathname === "/graph";
  const isHome = pathname === "/";
  const isSettings = pathname.startsWith("/settings");
  const initial = (displayName || email || "M").trim().charAt(0).toUpperCase();

  // ---------------------------------------------------------------- desktop
  const sidebarContent = (
    <aside className="mc-sidebar h-full overflow-y-auto">
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-white">
          <span className="mc-display text-[15px] text-[#121212]">M</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="mc-display text-[18px] font-semibold tracking-tight text-white">
            MindCanvas
          </span>
          <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
            v1
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleCapture}
        disabled={capturing}
        className="mc-btn-primary w-full py-3 disabled:opacity-60"
      >
        {capturing ? (
          <Loader2 {...ICON} className="animate-spin" />
        ) : (
          <Plus {...ICON} />
        )}
        New Thought
      </button>

      {!online && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-white/50">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-white/50"
          />
          Offline — changes sync when reconnected
        </p>
      )}

      <div className="mt-6 flex flex-col gap-1.5">
        <Link
          href="/"
          onClick={() => setMobileOpen(false)}
          className="mc-nav-item"
          data-active={isHome ? "true" : "false"}
        >
          <Home {...ICON} />
          Home
        </Link>
        <Link
          href="/graph"
          onClick={() => setMobileOpen(false)}
          className="mc-nav-item"
          data-active={isGraph ? "true" : "false"}
        >
          <Network {...ICON} />
          Graph View
        </Link>
        <Link
          href="/settings/import"
          onClick={() => setMobileOpen(false)}
          className="mc-nav-item"
          data-active={pathname.startsWith("/settings/import") ? "true" : "false"}
        >
          <Download {...ICON} />
          Import
        </Link>
        {/* Both open overlays mounted in layout.js rather than navigating,
            so neither carries data-active state. */}
        <SearchTrigger onNavigate={() => setMobileOpen(false)} />
        <AskAiTrigger onNavigate={() => setMobileOpen(false)} />
        <Link
          href="/settings"
          onClick={() => setMobileOpen(false)}
          className="mc-nav-item"
          data-active={
            isSettings && !pathname.startsWith("/settings/import") ? "true" : "false"
          }
        >
          <SettingsIcon {...ICON} />
          Settings
        </Link>
        <button
          type="button"
          onClick={handleExportVault}
          disabled={exporting}
          className="mc-nav-item disabled:opacity-60"
        >
          {exporting ? (
            <Loader2 {...ICON} className="animate-spin" />
          ) : (
            <Download {...ICON} />
          )}
          {exporting ? "Exporting…" : "Export vault"}
        </button>
        {exportError && (
          <p className="px-4 text-[11px] text-[#E4A08A]">{exportError}</p>
        )}
      </div>

      <div className="mt-8">
        <button
          type="button"
          onClick={() => setSpacesOpen((v) => !v)}
          className="flex w-full items-center justify-between"
        >
          <span className="mc-sidebar-label mb-0">SPACES</span>
          <ChevronDown
            size={14}
            strokeWidth={1.8}
            className={`text-white/40 transition-transform ${spacesOpen ? "" : "-rotate-90"}`}
          />
        </button>

        {spacesOpen && (
          <div className="mt-3 flex flex-col gap-1">
            {folders.map((folder) => (
              <Link
                key={folder.id}
                href={`/folder/${folder.id}`}
                onClick={() => setMobileOpen(false)}
                className="mc-space-row"
                data-active={activeFolderId === folder.id ? "true" : "false"}
              >
                <span className="truncate text-[13.5px] text-white/80">
                  {folder.name}
                </span>
                <span className="ml-2 shrink-0 text-[12px] text-white/40">
                  {noteCounts[folder.id] || 0} notes
                </span>
              </Link>
            ))}

            <button
              type="button"
              onClick={handleNewSpace}
              disabled={creating}
              className="mc-space-row justify-start gap-2 text-[13.5px] text-white/50 disabled:opacity-50"
            >
              <Plus size={15} strokeWidth={1.8} />
              {creating ? "Creating…" : "New space"}
            </button>
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center gap-3 border-t border-white/10 pt-5">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#F5F3EF] text-[12px] text-[#121212]">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-none text-white">
            {displayName || "Signed in"}
          </div>
          <div className="mt-1 truncate text-[11.5px] text-white/40" title={email}>
            {email}
          </div>
        </div>
        {online && (
          <span
            aria-label="Online"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#7A8E5D]"
          />
        )}
        <button
          type="button"
          onClick={handleLogout}
          aria-label="Log out"
          className="shrink-0 text-white/40 transition-colors hover:text-white"
        >
          <LogOut size={16} strokeWidth={1.8} />
        </button>
      </div>
    </aside>
  );

  // ----------------------------------------------------------------- mobile
  // Four items, matching the reference: Home, Spaces, Graph, Settings.
  const bottomNav = [
    { key: "home", label: "Home", href: "/", Icon: Home, active: isHome },
    {
      key: "spaces",
      label: "Spaces",
      onClick: () => setMobileOpen(true),
      Icon: Layers,
      active: mobileOpen || pathname.startsWith("/folder"),
    },
    { key: "graph", label: "Graph", href: "/graph", Icon: Network, active: isGraph },
    {
      key: "settings",
      label: "Settings",
      href: "/settings",
      Icon: SettingsIcon,
      active: isSettings,
    },
  ];

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden lg:block">{sidebarContent}</div>

      {/* Mobile: Spaces drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 lg:hidden">
            {sidebarContent}
          </div>
        </>
      )}

      {/* Mobile: floating capture button, sits above the bottom nav */}
      <button
        type="button"
        onClick={handleCapture}
        disabled={capturing}
        aria-label="New thought"
        className="mc-fab fixed bottom-[86px] right-5 z-40 disabled:opacity-60 lg:hidden"
      >
        {capturing ? (
          <Loader2 size={24} strokeWidth={1.8} className="animate-spin" />
        ) : (
          <Plus size={24} strokeWidth={1.8} />
        )}
      </button>

      {/* Mobile: bottom nav */}
      <nav className="mc-bottomnav fixed inset-x-0 bottom-0 z-40 flex items-center justify-around px-2 lg:hidden">
        {bottomNav.map(({ key, label, href, onClick, Icon, active }) => {
          const inner = (
            <>
              <Icon {...NAV_ICON} />
              <span>{label}</span>
              <span
                className={`-mt-0.5 h-1 w-1 rounded-full ${active ? "bg-[#121212]" : "bg-transparent"}`}
              />
            </>
          );
          return href ? (
            <Link
              key={key}
              href={href}
              className="mc-bottomnav-item"
              data-active={active ? "true" : "false"}
            >
              {inner}
            </Link>
          ) : (
            <button
              key={key}
              type="button"
              onClick={onClick}
              className="mc-bottomnav-item"
              data-active={active ? "true" : "false"}
            >
              {inner}
            </button>
          );
        })}
      </nav>
    </>
  );
}
