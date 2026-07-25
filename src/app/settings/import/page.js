"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { getAllFolders, createFolder, createNote } from "@/lib/db";
import { parseNotionZip } from "@/lib/notionImport";

// import-page phase state machine:
//   "idle"     – page loaded, no file picked
//   "parsing"  – JSZip extraction is running
//   "summary"  – file parsed, user must confirm "look at proposed folder layout"
//   "ai"       – calling /api/import-organize
//   "preview"  – AI proposal ready, user can edit and approve or cancel
//   "applying" – approval in progress (creating folders + notes)
//   "done"     – import complete; provide a "View in MindCanvas" CTA
//   "cancelled" – user cancelled; nothing was written, show retry CTA
//   "error"    – something went wrong, shown inline with retry option
//
// Propose-then-approve is hard-coded into this state machine: nothing in
// phases "parsing"/"summary"/"ai" ever calls createFolder/createNote. Real
// writes only happen in "applying", and only after the user explicitly
// clicked "Approve and import".

export default function ImportPage() {
  const router = useRouter();

  const [phase, setPhase] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef(null);

  const [parsedPages, setParsedPages] = useState([]);
  const [htmlSkipped, setHtmlSkipped] = useState(0);
  const [otherSkipped, setOtherSkipped] = useState(0);
  const [emptySkipped, setEmptySkipped] = useState(0);
  const [zipsRecursed, setZipsRecursed] = useState(0);
  const [debug, setDebug] = useState([]);

  const [existingFolders, setExistingFolders] = useState([]);

  // [{ folderKey, name, isNew, folderId?, pages: [{ title, path }] }]
  const [proposal, setProposal] = useState([]);

  const [applyProgress, setApplyProgress] = useState({
    foldersCreated: 0,
    notesCreated: 0,
    totalFolders: 0,
    totalNotes: 0,
  });

  const handlePickFile = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileChosen = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = "";
    if (!file) return;

    setPhase("parsing");
    setErrorMsg("");
    try {
      const {
        pages,
        htmlSkipped: hs,
        otherSkipped: os,
        emptySkipped: es,
        zipsRecursed: zr,
        debug: dbg,
      } = await parseNotionZip(file);
      setParsedPages(pages);
      setHtmlSkipped(hs);
      setOtherSkipped(os);
      setEmptySkipped(es);
      setZipsRecursed(zr);
      setDebug(dbg || []);
      if (pages.length === 0) {
        setErrorMsg(
          "No .md pages found in this export. Please choose a Notion export set to Markdown, not HTML.",
        );
        setPhase("error");
        return;
      }
      setPhase("summary");
    } catch (err) {
      setErrorMsg((err && err.message) || "Failed to parse the zip file.");
      setPhase("error");
    }
  };

  const handleContinueToAI = async () => {
    setPhase("ai");
    setErrorMsg("");
    try {
      const foldersSnapshot = await getAllFolders();
      const foldersLite = foldersSnapshot
        .filter((f) => f && f.id && f.name)
        .map((f) => ({ id: f.id, name: f.name }));
      setExistingFolders(foldersLite);

      const res = await fetch("/api/import-organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pages: parsedPages.map((p) => ({
            title: p.title,
            content: p.content,
            path: p.path,
          })),
          existingFolders: foldersLite,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body && body.error ? body.error : "AI service failed. Try again or cancel.");
        setPhase("error");
        return;
      }

      const orderedProposed = (body && body.proposedFolders) || [];

      // Build a lookup from title+path -> { title, content, path } from the
      // original parsed pages so we can re-attach content to every page the
      // AI proposed. The AI response deliberately omits content (it only needs
      // title+path for the preview), but the approval step must pass real
      // content to createNote(). Without this lookup, notes end up with empty
      // bodies — page.title from parser is always correct but page.content is
      // undefined from the AI-folders response.
      const contentByTitlePath = new Map();
      for (const pp of parsedPages) {
        contentByTitlePath.set(pp.title + "\u0001" + pp.path, pp.content);
      }

      const withKeys = orderedProposed.map((pf, idx) => ({
        ...pf,
        folderKey: "pf-" + idx,
        folderId: pf.isNew
          ? null
          : (foldersLite.find(
              (ef) => ef.name.toLowerCase() === String(pf.name || "").toLowerCase(),
            ) || {}).id || null,
        pages: (pf.pages || []).map((p) => ({
          title: p.title,
          path: p.path || "",
          content: contentByTitlePath.get(p.title + "\u0001" + p.path) || "",
        })),
      }));

      // If the AI omitted pages, append them to a catch-all bucket so the
      // preview UI shows the full accounting and nothing silently disappears.
      const seenTitlePath = new Set();
      for (const pf of withKeys) {
        for (const p of pf.pages) seenTitlePath.add(p.title + "\u0001" + p.path);
      }
      const orphans = parsedPages
        .filter((p) => !seenTitlePath.has(p.title + "\u0001" + p.path))
        .map((p) => ({ title: p.title, path: p.path, content: p.content }));
      if (orphans.length > 0) {
        withKeys.push({
          folderKey: "pf-orphan",
          name: "Unfiled (review these)",
          isNew: true,
          folderId: null,
          pages: orphans,
        });
      }

      setProposal(withKeys);
      setPhase("preview");
    } catch (err) {
      setErrorMsg((err && err.message) || "AI step failed.");
      setPhase("error");
    }
  };

  const handleCancel = () => {
    setParsedPages([]);
    setProposal([]);
    setExistingFolders([]);
    setPhase("cancelled");
  };

  const handleStartOver = () => {
    setParsedPages([]);
    setProposal([]);
    setExistingFolders([]);
    setErrorMsg("");
    setHtmlSkipped(0);
    setOtherSkipped(0);
    setEmptySkipped(0);
    setZipsRecursed(0);
    setDebug([]);
    setPhase("idle");
  };

  const handleAddFolderBucket = () => {
    const name = window.prompt("Name for the new folder bucket:");
    if (!name || !name.trim()) return;
    setProposal((prev) => [
      ...prev,
      {
        folderKey: "pf-new-" + prev.length,
        name: name.trim(),
        isNew: true,
        folderId: null,
        pages: [],
      },
    ]);
  };

  const handleMovePage = (fromKey, pageIdx, toKey) => {
    setProposal((prev) => {
      const next = prev.map((pf) => ({ ...pf, pages: pf.pages.slice() }));
      const from = next.find((pf) => pf.folderKey === fromKey);
      const to = next.find((pf) => pf.folderKey === toKey);
      if (!from || !to) return prev;
      const [moved] = from.pages.splice(pageIdx, 1);
      to.pages.push(moved);
      return next.filter((pf) => pf.pages.length > 0 || !pf.isNew);
    });
  };

  const handleRenameBucket = (folderKey, newName) => {
    setProposal((prev) =>
      prev.map((pf) =>
        pf.folderKey === folderKey
          ? { ...pf, name: (newName || "").trim() || pf.name, isNew: true, folderId: null }
          : pf,
      ),
    );
  };

  const handleApply = async () => {
    setErrorMsg("");
    setPhase("applying");

    const totalFolders = proposal.length;
    const totalNotes = proposal.reduce((sum, pf) => sum + pf.pages.length, 0);
    setApplyProgress({ foldersCreated: 0, notesCreated: 0, totalFolders, totalNotes });

    let createdFolders = 0;
    let createdNotes = 0;
    try {
      const resolved = {};
      for (const pf of proposal) {
        let folderId = pf.folderId;
        if (pf.isNew || !folderId) {
          folderId = await createFolder(pf.name);
          createdFolders += 1;
          setApplyProgress((p) => ({ ...p, foldersCreated: createdFolders }));
        }
        resolved[pf.folderKey] = folderId;
      }

      for (const pf of proposal) {
        const folderId = resolved[pf.folderKey];
        for (const page of pf.pages) {
          await createNote(folderId, page.title, page.content);
          createdNotes += 1;
          setApplyProgress((p) => ({ ...p, notesCreated: createdNotes }));
        }
      }

      setPhase("done");
    } catch (err) {
      setErrorMsg(
        "Import stopped partway: " +
          ((err && err.message) || "unknown error") +
          ". " +
          createdFolders +
          " folder(s) and " +
          createdNotes +
          " note(s) were already created.",
      );
      setPhase("error");
    }
  };

  const pageBg = { background: "var(--bg)" };
  const card = { background: "var(--surface)", borderRadius: "16px" };

  return (
    <div className="flex min-h-screen" style={pageBg}>
      <Sidebar />

      <div
        className="relative min-h-screen flex-1 px-5 pt-6 pb-8 lg:pl-5 pl-14"
        style={pageBg}
      >
        <div
          className="flex items-center gap-1 transition-colors cursor-pointer text-sm font-sans"
          style={{ color: "var(--text-muted)" }}
          onClick={() => router.push("/settings")}
        >
          <span>&larr</span>
          <span>Settings</span>
       </div>

        <header className="mt-4">
          <p
            className="font-sans text-xs uppercase tracking-widest font-semibold"
            style={{ color: "var(--text-muted)" }}
          >
            SETTINGS &middot; IMPORTS
         </p>
          <h1
            className="font-serif text-3xl font-bold mt-1"
            style={{ color: "var(--text-primary)" }}
          >
            Import from Notion
         </h1>
          <p
            className="font-sans text-sm mt-1 max-w-2xl leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            In Notion, choose <span className="font-semibold">Settings &rarr; Export</span>{" "}
            with <span className="font-semibold">Markdown</span> format, then upload the{" "}
            <code
              className="font-mono text-xs px-1.5 py-0.5 rounded"
              style={{ background: "var(--border)", color: "var(--text-primary)" }}
            >
              .zip
           </code>{" "}
            here. We&apos;ll show you a preview before anything is added to your account.
         </p>
       </header>

        <section className="mt-8 max-w-3xl">
          <ol
            className="flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-xs uppercase tracking-widest font-semibold mb-4"
            style={{ color: "var(--text-muted)" }}
          >
            <li className={phaseStepClass("idle", phase)}>1 &middot; Upload</li>
            <li>&rarr</li>
            <li className={phaseStepClass("summary", phase)}>2 &middot; Confirm</li>
            <li>&rarr</li>
            <li className={phaseStepClass("ai", phase)}>3 &middot; AI preview</li>
            <li>&rarr</li>
            <li className={phaseStepClass("applying", phase)}>4 &middot; Approve</li>
            <li>&rarr</li>
            <li className={phaseStepClass("done", phase)}>5 &middot; Done</li>
         </ol>

          {errorMsg && (
            <div
              className="p-3 mb-4 rounded-lg font-sans text-sm"
              style={{
                color: "#DC2626",
                background: "rgba(220, 38, 38, 0.08)",
                border: "1px solid rgba(220, 38, 38, 0.3)",
              }}
              role="alert"
            >
              {errorMsg}
           </div>
          )}

          {phase === "idle" && (
            <div className="p-6" style={card}>
              <p
                className="font-sans text-sm leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                Pick the Notion export zip from your device. Nothing is uploaded anywhere
                &mdash; we read it directly in your browser.
             </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                onChange={handleFileChosen}
                className="hidden"
              />
              <button
                type="button"
                onClick={handlePickFile}
                className="mt-5 rounded-full px-5 py-2.5 font-sans text-sm font-semibold shadow-md transition-all active:scale-[0.98]"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                Choose Notion export&hellip;
             </button>
           </div>
          )}

          {phase === "parsing" && (
            <div className="p-6" style={card}>
              <p
                className="font-sans text-sm animate-pulse"
                style={{ color: "var(--text-secondary)" }}
              >
                Reading your zip&hellip;
             </p>
           </div>
          )}

          {phase === "summary" && (
            <div className="p-6" style={card}>
              <h2
                className="font-serif text-xl font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                Found {parsedPages.length}{" "}
                {parsedPages.length === 1 ? "page" : "pages"} across{" "}
                {uniqueFolderCount(parsedPages)}{" "}
                {uniqueFolderCount(parsedPages) === 1 ? "folder" : "folders"}
             </h2>
              {zipsRecursed > 0 && (
                <p
                  className="font-sans text-xs mt-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  Recursed into {zipsRecursed} nested{" "}
                  {zipsRecursed === 1 ? "zip" : "zips"} to find the pages above.
               </p>
              )}

              {(htmlSkipped > 0 || otherSkipped > 0 || emptySkipped > 0) && (
                <p
                  className="font-sans text-xs mt-1"
                  style={{ color: "var(--text-muted)" }}
                >
                  Skipped:
                  {htmlSkipped > 0
                    ? " " + htmlSkipped + " HTML " + (htmlSkipped === 1 ? "file" : "files")
                    : ""}
                  {otherSkipped > 0
                    ? (htmlSkipped > 0 ? "," : "") +
                      " " +
                      otherSkipped +
                      " other " +
                      (otherSkipped === 1 ? "file" : "files")
                    : ""}
                  {emptySkipped > 0
                    ? (htmlSkipped + otherSkipped > 0 ? "," : "") +
                      " " +
                      emptySkipped +
                      " empty " +
                      (emptySkipped === 1 ? "page" : "pages")
                    : ""}
                  .{htmlSkipped > 0 ? " Re-export as Markdown to include HTML pages." : ""}
               </p>
              )}
              <p
                className="font-sans text-sm mt-3 leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                We&apos;ll send a summary of these pages to the AI to propose a folder layout.
                You&apos;ll see the proposal before anything is added to your MindCanvas.
             </p>

              <SamplePageList pages={parsedPages} />

              {(debug && debug.length > 0) && (
                <div
                  className="mt-3 p-3 rounded-lg font-sans text-xs"
                  style={{
                    background: "color-mix(in srgb, var(--bg) 80%, var(--surface))",
                    border: "1px solid var(--border)",
                  }}
                >
                  <p style={{ color: "var(--text-muted)" }} className="font-semibold uppercase tracking-wider mb-1">
                    Content diagnostics (first {Math.min(debug.length, 3)} files)
                 </p>
                  <ul style={{ color: "var(--text-secondary)" }}>
                    {debug.map((d,i) => (
                      <li key={i}>
                        &ldquo;{d.title}&rdquo;: {d.rawBytesLen} raw bytes &rarr; {d.decodedTextLen} chars decoded
                        {d.rawBytesLen > 0 && d.decodedTextLen === 0 && (
                          <span style={{ color: "#DC2626" }}>
                            {" "}&mdash; DECODER FAILED (bytes present, text empty)
                         </span>
                        )}
                        {d.rawBytesLen === 0 && (
                          <span style={{ color: "#DC2626" }}>
                            {" "}&mdash; JSZip returned zero bytes for this entry
                         </span>
                        )}
                        {d.bodyPreview && (
                          <span style={{ color: "var(--text-muted)" }}>
                            ; preview &ldquo;{d.bodyPreview}&rdquo;
                         </span>
                        )}
                     </li>
                    ))}
                 </ul>
               </div>
              )}

              <div className="flex flex-wrap gap-3 mt-5">
                <button
                  type="button"
                  onClick={handleContinueToAI}
                  className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold shadow-md transition-all active:scale-[0.98]"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  Continue to AI preview
               </button>
                <button
                  type="button"
                  onClick={handleStartOver}
                  className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold border transition-all active:scale-[0.98]"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--text-primary)",
                    background: "transparent",
                  }}
                >
                  Pick a different file
               </button>
             </div>
           </div>
          )}

          {phase === "ai" && (
            <div className="p-6" style={card}>
              <p
                className="font-sans text-sm animate-pulse"
                style={{ color: "var(--text-secondary)" }}
              >
                Asking AI to propose a folder layout&hellip;
             </p>
              <p
                className="font-sans text-xs mt-2"
                style={{ color: "var(--text-muted)" }}
              >
                This may take a few seconds for larger exports.
             </p>
           </div>
          )}

          {phase === "preview" && (
            <div className="flex flex-col gap-4">
              <div className="p-6" style={card}>
                <h2
                  className="font-serif text-xl font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  Proposed folder layout
               </h2>
                <p
                  className="font-sans text-sm mt-1 leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {existingFolders.length > 0
                    ? "We\u2019ll use your existing folders where they fit, and propose new folders for the rest."
                    : "We\u2019ll propose new folders for everything."}
               </p>
                <p
                  className="font-sans text-xs mt-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  You can move any page to a different folder before approving. Nothing is
                  written until you click Approve import.
               </p>
             </div>

              <ProposalPreview
                proposal={proposal}
                onMovePage={handleMovePage}
                onRenameBucket={handleRenameBucket}
                onAddBucket={handleAddFolderBucket}
              />

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleApply}
                  className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold shadow-md transition-all active:scale-[0.98]"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  Approve and import
               </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold border transition-all active:scale-[0.98]"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--text-primary)",
                    background: "transparent",
                  }}
                >
                  Cancel
               </button>
             </div>
           </div>
          )}

          {phase === "applying" && (
            <div className="p-6" style={card}>
              <p
                className="font-sans text-sm animate-pulse"
                style={{ color: "var(--text-secondary)" }}
              >
                Importing {applyProgress.notesCreated} / {applyProgress.totalNotes}
                {applyProgress.totalNotes === 1 ? " note" : " notes"}&hellip;
             </p>
              <p
                className="font-sans text-xs mt-2"
                style={{ color: "var(--text-muted)" }}
              >
                Creating {applyProgress.totalFolders}{" "}
                {applyProgress.totalFolders === 1 ? "folder" : "folders"} and{" "}
                {applyProgress.totalNotes}{" "}
                {applyProgress.totalNotes === 1 ? "note" : "notes"}&hellip;
             </p>
           </div>
          )}

          {phase === "done" && (
            <div className="p-6" style={card}>
              <h2
                className="font-serif text-xl font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                Import complete
             </h2>
              <p
                className="font-sans text-sm mt-2 leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                We added{" "}
                <span className="font-semibold">
                  {applyProgress.foldersCreated} new{" "}
                  {applyProgress.foldersCreated === 1 ? "folder" : "folders"}
               </span>{" "}
                and{" "}
                <span className="font-semibold">
                  {applyProgress.notesCreated} notes
               </span>{" "}
                to your MindCanvas.
             </p>
              <div className="flex flex-wrap gap-3 mt-5">
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold shadow-md transition-all active:scale-[0.98]"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  Open dashboard
               </button>
                <button
                  type="button"
                  onClick={handleStartOver}
                  className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold border transition-all active:scale-[0.98]"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--text-primary)",
                    background: "transparent",
                  }}
                >
                  Import another export
               </button>
             </div>
           </div>
          )}

          {phase === "cancelled" && (
            <div className="p-6" style={card}>
              <h2
                className="font-serif text-xl font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                Import cancelled
             </h2>
              <p
                className="font-sans text-sm mt-2 leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                Nothing was added to your MindCanvas. You can import a different Notion
                export whenever you want.
             </p>
              <div className="flex flex-wrap gap-3 mt-5">
                <button
                  type="button"
                  onClick={handleStartOver}
                  className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold shadow-md transition-all active:scale-[0.98]"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  Try again
               </button>
                <button
                  type="button"
                  onClick={() => router.push("/settings")}
                  className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold border transition-all active:scale-[0.98]"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--text-primary)",
                    background: "transparent",
                  }}
                >
                  Back to settings
               </button>
             </div>
           </div>
          )}

          {phase === "error" && (
            <div className="p-6" style={card}>
              <p
                className="font-sans text-sm"
                style={{ color: "var(--text-secondary)" }}
              >
                {errorMsg || "Something went wrong."}
             </p>
              <div className="flex flex-wrap gap-3 mt-5">
                <button
                  type="button"
                  onClick={handleStartOver}
                  className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold shadow-md transition-all active:scale-[0.98]"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  Start over
               </button>
                <button
                  type="button"
                  onClick={() => router.push("/settings")}
                  className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold border transition-all active:scale-[0.98]"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--text-primary)",
                    background: "transparent",
                  }}
                >
                  Back to settings
               </button>
             </div>
           </div>
          )}
       </section>
     </div>
   </div>
  );
}

// ---- helpers ----

function uniqueFolderCount(pages) {
  const set = new Set();
  for (const p of pages) {
    if (p && p.path) set.add(p.path);
  }
  return set.size;
}

function phaseStepClass(name, currentPhase) {
  const order = ["idle", "summary", "ai", "preview", "applying", "done", "cancelled", "error"];
  const currentIdx = order.indexOf(currentPhase);
  const targetIdx = order.indexOf(name);
  const isActive = currentPhase === name;
  const isPastTarget = ["idle", "summary", "ai"].includes(name) && currentIdx > targetIdx;
  if (isActive) return "font-bold";
  if (isPastTarget) return "opacity-60 line-through";
  return "opacity-40";
}

function SamplePageList({ pages }) {
  const head = pages.slice(0, 8);
  const more = pages.length - head.length;
  return (
    <div className="mt-4">
      <p
        className="font-sans text-xs uppercase tracking-widest font-semibold mb-2"
        style={{ color: "var(--text-muted)" }}
      >
        Preview of first {Math.min(head.length, 10)} pages
     </p>
      <ul
        className="rounded-lg overflow-hidden border"
        style={{ borderColor: "var(--border)" }}
      >
        {head.map((p, i) => (
          <li
            key={p.title + "-" + i}
            className="px-3 py-2 font-sans text-sm flex items-center justify-between gap-3"
            style={{
              color: "var(--text-primary)",
              borderBottom:
                i === head.length - 1 ? "none" : "1px solid var(--border)",
              background:
                i % 2 === 0
                  ? "var(--bg)"
                  : "color-mix(in srgb, var(--bg) 70%, var(--surface))",
            }}
          >
            <span className="truncate">{p.title}</span>
            {p.path && (
              <span
                className="shrink-0 text-xs font-mono"
                style={{ color: "var(--text-muted)" }}
              >
                {p.path}
             </span>
            )}
         </li>
        ))}
     </ul>
      <span style={{ display: "none" }}>{Math.min(head.length, 10)}</span>
      {more > 0 && (
        <p
          className="font-sans text-xs mt-2"
          style={{ color: "var(--text-muted)" }}
        >
          &hellip;and {more} more {more === 1 ? "page" : "pages"} not shown
       </p>
      )}
   </div>
  );
}

function ProposalPreview({ proposal, onMovePage, onRenameBucket, onAddBucket }) {
  return (
    <div className="flex flex-col gap-3">
      {proposal.map((pf) => (
        <ProposalFolder
          key={pf.folderKey}
          bucket={pf}
          allBuckets={proposal}
          onMovePage={onMovePage}
          onRenameBucket={onRenameBucket}
        />
      ))}

      <button
        type="button"
        onClick={onAddBucket}
        className="self-start rounded-full px-4 py-2 font-sans text-sm font-semibold border transition-all active:scale-[0.98]"
        style={{
          borderColor: "var(--border)",
          color: "var(--text-primary)",
          background: "transparent",
        }}
      >
        + Add folder
     </button>
   </div>
  );
}

function ProposalFolder({ bucket, allBuckets, onMovePage, onRenameBucket }) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(bucket.name);

  const badge = !bucket.isNew ? (
    <span
      className="text-xs font-sans px-2 py-0.5 rounded-full font-semibold"
      style={{
        background: "color-mix(in srgb, var(--accent-secondary) 22%, transparent)",
        color: "var(--accent-secondary)",
      }}
    >
      Existing
   </span>
  ) : (
    <span
      className="text-xs font-sans px-2 py-0.5 rounded-full font-semibold"
      style={{
        background: "color-mix(in srgb, var(--accent) 22%, transparent)",
        color: "var(--accent)",
      }}
    >
      New
   </span>
  );

  return (
    <div className="p-4" style={{ background: "var(--surface)", borderRadius: "14px" }}>
      <div className="flex items-center gap-2 mb-2">
        {editingName ? (
          <>
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => {
                onRenameBucket(bucket.folderKey, draftName);
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRenameBucket(bucket.folderKey, draftName);
                  setEditingName(false);
                } else if (e.key === "Escape") {
                  setDraftName(bucket.name);
                  setEditingName(false);
                }
              }}
              autoFocus
              className="themed-placeholder font-sans text-base font-semibold rounded px-2 py-1 outline-none border"
              style={{
                color: "var(--text-primary)",
                borderColor: "var(--border)",
                background: "var(--bg)",
              }}
            />
            <button
              type="button"
              onClick={() => {
                onRenameBucket(bucket.folderKey, draftName);
                setEditingName(false);
              }}
              className="font-sans text-xs px-2 py-1 rounded font-semibold"
              style={{ color: "var(--accent)" }}
            >
              Save
           </button>
          </>
        ) : (
          <>
            <h3
              className="font-serif text-base font-bold truncate cursor-text"
              style={{ color: "var(--text-primary)" }}
              onClick={() => {
                setDraftName(bucket.name);
                setEditingName(true);
              }}
              title="Click to rename"
            >
              {bucket.name}
           </h3>
            <button
              type="button"
              onClick={() => {
                setDraftName(bucket.name);
                setEditingName(true);
              }}
              className="font-sans text-xs"
              style={{ color: "var(--text-muted)" }}
              title="Rename folder"
              aria-label="Rename folder"
            >
              &#9998;
           </button>
          </>
        )}
        {badge}
        <span
          className="ml-auto font-sans text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          {bucket.pages.length}{" "}
          {bucket.pages.length === 1 ? "page" : "pages"}
       </span>
     </div>

      {bucket.pages.length === 0 ? (
        <p
          className="font-sans text-sm italic"
          style={{ color: "var(--text-muted)" }}
        >
          No pages &mdash; drag or pick pages to move here.
       </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {bucket.pages.map((page, idx) => (
            <li
              key={bucket.folderKey + "-" + page.title + "-" + idx}
              className="flex flex-wrap items-center gap-3 px-3 py-2 rounded-lg"
              style={{ background: "var(--bg)" }}
            >
              <span
                className="font-sans text-sm font-medium flex-1 min-w-[160px] truncate"
                style={{ color: "var(--text-primary)" }}
              >
                {page.title}
             </span>
              {page.path && (
                <span
                  className="font-mono text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  {page.path}
               </span>
              )}
              <select
                value={bucket.folderKey}
                onChange={(e) => {
                  const target = e.target.value;
                  if (target !== bucket.folderKey) {
                    onMovePage(bucket.folderKey, idx, target);
                  }
                }}
                className="font-sans text-xs rounded px-2 py-1 border outline-none"
                style={{
                  background: "var(--surface)",
                  color: "var(--text-primary)",
                  borderColor: "var(--border)",
                }}
              >
                {allBuckets
                  .filter(
                    (other) => other.pages.length > 0 || other.folderKey === bucket.folderKey,
                  )
                  .map((other) => (
                    <option key={other.folderKey} value={other.folderKey}>
                      Move to: {other.name}
                   </option>
                  ))}
             </select>
           </li>
          ))}
       </ul>
      )}
   </div>
  );
}
