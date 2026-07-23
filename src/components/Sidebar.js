"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getAllFolders, getNotesInFolder, createFolder } from "@/lib/db";
import { createClient } from "@/lib/supabase/client";

export default function Sidebar({ activeFolderId = null }) {
  const pathname = usePathname();
  const [folders, setFolders] = useState([]);
  const [noteCounts, setNoteCounts] = useState({});
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  // Lazy initializer runs on the client only (the component only mounts in
  // the browser because it's inside AuthGate). Reading navigator.onLine
  // here avoids calling setState synchronously inside the effect, which
  // would trip react-hooks/set-state-in-effect.
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

    // Refresh display_name when settings page updates it (Part B).
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

  // Track online/offline state for the indicator (Part B6). navigator.onLine
  // is true/false at startup (read via lazy initializer above); the
  // online/offline window events fire when it changes. We deliberately
  // don't read navigator inside the effect body because that triggers a
  // cascading-render warning.
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
      const stamp = new Date()
        .toISOString()
        .slice(0, 10);
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

  const handleLogout = async () => {
    const supabase = createClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
  };

  const isGraph = pathname === "/graph";

  const sidebarContent = (
    <aside
      className="flex h-full w-[240px] shrink-0 flex-col bg-ink text-bone"
      style={{ backgroundColor: "var(--sidebar-bg)" }}
    >
      <div className="border-b border-graph-line/40 px-5 py-6">
        <Link
          href="/"
          onClick={() => setMobileOpen(false)}
          className="font-serif text-xl font-bold tracking-tight text-bone hover:text-clay transition-colors"
          style={{ color: "var(--sidebar-text)" }}
        >
          MindCanvas
        </Link>
        {/* Offline indicator (Part B6) — shows when navigator.onLine is false. */}
        {!online && (
          <p
            className="mt-2 flex items-center gap-1.5 font-sans text-[11px] text-warm-gray"
            style={{ color: "var(--sidebar-text-muted)" }}
          >
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-warm-gray"
            />
            Offline — changes will sync when reconnected
          </p>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <p
          className="px-2 font-sans text-[10px] font-semibold uppercase tracking-widest text-warm-gray-light"
          style={{ color: "var(--sidebar-text-muted)" }}
        >
          Spaces
        </p>
        <ul className="mt-2 flex flex-col gap-0.5">
          {folders.map((folder) => {
            const active = activeFolderId === folder.id;
            const count = noteCounts[folder.id] || 0;
return (
                  <li key={folder.id}>
                <Link
                  href={`/folder/${folder.id}`}
                  onClick={() => setMobileOpen(false)}
                  className={`sidebar-item flex items-center justify-between rounded-lg px-3 py-2.5 font-sans text-sm transition-colors ${
                    active
                      ? "text-bone font-semibold"
                      : "text-warm-gray-light hover:bg-white/5 hover:text-bone"
                  }`}
                  style={{ color: active ? "var(--sidebar-text)" : "var(--sidebar-text-muted)" }}
                >
                  {/* Active indicator: 3px clay bar on the left, slides in via the animation */}
                  {active && (
                    <span className="absolute left-0 top-1 bottom-1 w-[3px] bg-clay rounded-r-sm sidebar-indicator" />
                  )}
                  <span className="truncate">{folder.name}</span>
                  <span
                    className="ml-2 shrink-0 text-xs text-warm-gray"
                    style={{ color: "var(--sidebar-text-muted)" }}
                  >
                    {count}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <button
          onClick={handleNewSpace}
          disabled={creating}
          className="mt-3 w-full rounded-lg px-3 py-2.5 text-left font-sans text-sm text-warm-gray-light hover:bg-white/5 hover:text-bone transition-colors disabled:opacity-50"
          style={{ color: "var(--sidebar-text-muted)" }}
        >
          {creating ? "Creating..." : "+ New space"}
        </button>

        <div className="my-4 border-t border-graph-line/40" />

        <Link
          href="/graph"
          onClick={() => setMobileOpen(false)}
          className={`sidebar-item flex items-center rounded-lg px-3 py-2.5 font-sans text-sm transition-colors relative ${
            isGraph
              ? "text-bone font-semibold"
              : "text-warm-gray-light hover:bg-white/5 hover:text-bone"
          }`}
          style={{ color: isGraph ? "var(--sidebar-text)" : "var(--sidebar-text-muted)" }}
        >
          {isGraph && (
            <span className="absolute left-0 top-1 bottom-1 w-[3px] bg-clay rounded-r-sm sidebar-indicator" />
          )}
          Second brain
        </Link>
      </nav>

      <div className="border-t border-graph-line/40 px-5 py-4">
        <button
          type="button"
          onClick={handleExportVault}
          disabled={exporting}
          className="mb-3 flex w-full items-center gap-2 font-sans text-xs font-semibold text-warm-gray-light hover:text-bone transition-colors disabled:opacity-60"
          style={{ color: "var(--sidebar-text-muted)" }}
          title="Download all your notes as a ZIP of Markdown files"
        >
          {exporting ? (
            <>
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-warm-gray-light border-t-transparent"
                style={{ borderColor: "var(--sidebar-text-muted)" }}
              />
              Exporting…
            </>
          ) : (
            <>
              <span aria-hidden="true" className="text-sm leading-none">
                ↓
              </span>
              Export vault
            </>
          )}
        </button>
        {exportError && (
          <p className="mb-2 font-sans text-[11px] text-clay">{exportError}</p>
        )}

        <Link
          href="/settings"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-1.5 font-sans text-xs font-semibold text-warm-gray-light hover:text-bone transition-colors mb-2"
          style={{ color: "var(--sidebar-text-muted)" }}
        >
          <span aria-hidden="true" className="text-sm leading-none">⚙</span>
          Settings
        </Link>
        {(displayName || email) && (
          <p
            className="truncate font-sans text-xs text-warm-gray mb-2"
            style={{ color: "var(--sidebar-text-muted)" }}
            title={email}
          >
            {displayName || email}
          </p>
        )}
        <button
          onClick={handleLogout}
          className="font-sans text-xs font-semibold text-warm-gray-light hover:text-bone transition-colors"
          style={{ color: "var(--sidebar-text-muted)" }}
        >
          Log out
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 flex h-9 w-9 items-center justify-center rounded-full bg-ink text-bone shadow-md lg:hidden"
        style={{ backgroundColor: "var(--sidebar-bg)", color: "var(--sidebar-text)" }}
        aria-label="Open menu"
      >
        <span className="text-lg leading-none">☰</span>
      </button>

      {/* Desktop sidebar */}
      <div className="hidden lg:block">{sidebarContent}</div>

      {/* Mobile overlay sidebar */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-ink/50 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 lg:hidden">{sidebarContent}</div>
        </>
      )}
    </>
  );
}
