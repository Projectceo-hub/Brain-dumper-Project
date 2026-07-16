"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getAllFolders, getNotesInFolder, createFolder } from "@/lib/db";
import { createClient } from "@/lib/supabase/client";

export default function Sidebar({ activeFolderId = null }) {
  const pathname = usePathname();
  const [folders, setFolders] = useState([]);
  const [noteCounts, setNoteCounts] = useState({});
  const [email, setEmail] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadSidebar = async () => {
    const folderList = await getAllFolders();
    setFolders(folderList);

    const counts = {};
    for (const folder of folderList) {
      const notes = await getNotesInFolder(folder.id);
      counts[folder.id] = notes.length;
    }
    setNoteCounts(counts);
  };

  useEffect(() => {
    loadSidebar();
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email || "");
    });
  }, []);

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
      style={{ backgroundColor: "#1C1912" }}
    >
      <div className="border-b border-graph-line/40 px-5 py-6">
        <Link
          href="/"
          onClick={() => setMobileOpen(false)}
          className="font-serif text-xl font-bold tracking-tight text-bone hover:text-clay transition-colors"
        >
          MindCanvas
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <p className="px-2 font-sans text-[10px] font-semibold uppercase tracking-widest text-warm-gray-light">
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
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 font-sans text-sm transition-colors ${
                    active
                      ? "bg-clay/20 text-bone font-semibold"
                      : "text-warm-gray-light hover:bg-white/5 hover:text-bone"
                  }`}
                >
                  <span className="truncate">{folder.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-warm-gray">{count}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <button
          onClick={handleNewSpace}
          disabled={creating}
          className="mt-3 w-full rounded-lg px-3 py-2.5 text-left font-sans text-sm text-warm-gray-light hover:bg-white/5 hover:text-bone transition-colors disabled:opacity-50"
        >
          {creating ? "Creating..." : "+ New space"}
        </button>

        <div className="my-4 border-t border-graph-line/40" />

        <Link
          href="/graph"
          onClick={() => setMobileOpen(false)}
          className={`flex items-center rounded-lg px-3 py-2.5 font-sans text-sm transition-colors ${
            isGraph
              ? "bg-clay/20 text-bone font-semibold"
              : "text-warm-gray-light hover:bg-white/5 hover:text-bone"
          }`}
        >
          Second brain
        </Link>
      </nav>

      <div className="border-t border-graph-line/40 px-5 py-4">
        {email && (
          <p className="truncate font-sans text-xs text-warm-gray mb-2" title={email}>
            {email}
          </p>
        )}
        <button
          onClick={handleLogout}
          className="font-sans text-xs font-semibold text-warm-gray-light hover:text-bone transition-colors"
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
