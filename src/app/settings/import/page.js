"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import {
  getAllFolders,
  createFolder,
  createNote,
  updateNote,
  createNoteLink,
} from "@/lib/db";
import {
  parseNotionZip,
  convertNotionLinksInImportedNotes,
} from "@/lib/notionImport";
import {
  useImportFlow,
  PhaseSteps,
  SamplePageList,
  ProposalPreview,
} from "@/components/importFlow";

// Notion import flow (Phase 6 Part A).
//
// This page reuses the shared propose-then-approve state machine from
// src/components/importFlow.js. The Obsidian import (Phase 6 Part B) uses
// the same shared module — the only differences between the two pages are:
//   - The parser (parseNotionZip vs parseObsidianZip).
//   - The `source` flag sent to /api/import-organize ("notion" | "obsidian").
//   - The skipped-file summary card (Notion surfaces htmlSkipped +
//     zipsRecursed + debug probe; Obsidian surfaces config-skipped +
//     non-Markdown-skipped).
//
// import-page phase state machine is owned by useImportFlow:
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
// Propose-then-approve is hard-coded into the state machine: nothing in
// phases "parsing"/"summary"/"ai" ever calls createFolder/createNote. Real
// writes only happen in "applying", and only after the user explicitly
// clicked "Approve and import".

export default function ImportPage() {
  const router = useRouter();
  const fileInputRef = useRef(null);

  // Phase 6 Part C: counters surfaced in the "Import complete" card after
  // the Notion internal-page-link post-step has run. Mirrors the Obsidian
  // page's wikilinkStats.
  const [notionLinkStats, setNotionLinkStats] = useState({
    linksCreated: 0,
    notionLinksProcessed: 0,
    dangling: 0,
  });

  const flow = useImportFlow({ parse: parseNotionZip, source: "notion" });
  const {
    phase,
    errorMsg,
    parsedPages,
    extraCounts,
    existingFolders,
    proposal,
    applyProgress,
    handleFileChosen,
    handleContinueToAI,
    handleCancel,
    handleStartOver,
    handleAddFolderBucket,
    handleMovePage,
    handleRenameBucket,
    handleApply,
  } = flow;

  // Notion-specific counters exploded out of the shared extraCounts bag.
  // We name them here so the summary card below can render the same fields
  // Part A always has (HTML skipped, nested zips recursed, debug probe).
  const htmlSkipped = extraCounts.htmlSkipped || 0;
  const otherSkipped = extraCounts.otherSkipped || 0;
  const emptySkipped = extraCounts.emptySkipped || 0;
  const zipsRecursed = extraCounts.zipsRecursed || 0;
  const debug = extraCounts.debug || [];

  const handlePickFile = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const onFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    handleFileChosen(file);
  };

  const pageBg = { background: "var(--bg)" };
  const card = {
    background: "var(--card-bg)",
    borderRadius: "var(--radius-panel)",
    border: "1px solid var(--border-1)",
    boxShadow: "var(--shadow-card)",
  };

  return (
    <div className="flex min-h-screen" style={pageBg}>
      <Sidebar />

      <div
        className="relative min-h-screen flex-1 px-5 pt-6 pb-40 lg:px-8 lg:pb-8"
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
            className="mc-display text-[30px] mt-1"
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
          <PhaseSteps phase={phase} />

          {errorMsg && (
            <div
              className="p-3 mb-4 rounded-[14px] font-sans text-sm"
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
                onChange={onFile}
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
                className="mc-display text-[20px]"
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
                  className="mt-3 p-3 rounded-[14px] font-sans text-xs"
                  style={{
                    background: "color-mix(in srgb, var(--bg) 80%, var(--surface))",
                    border: "1px solid var(--border)",
                  }}
                >
                  <p style={{ color: "var(--text-muted)" }} className="font-semibold uppercase tracking-wider mb-1">
                    Content diagnostics (first {Math.min(debug.length, 3)} files)
                  </p>
                  <ul style={{ color: "var(--text-secondary)" }}>
                    {debug.map((d, i) => (
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
                  onClick={() => handleContinueToAI({ getAllFolders })}
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
                  className="mc-display text-[20px]"
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
                  onClick={async () => {
                    const createdDescriptors = await handleApply({
                      createFolder,
                      createNote,
                    });
                    // Phase 6 Part C: post-approval Notion internal-page
                    // link conversion. Same contract as the Obsidian
                    // wikilink step — runs only when notes were actually
                    // created, tolerates a partial list if handleApply
                    // threw partway, and never flips the card to the error
                    // state just because the post-step failed (the import
                    // itself already succeeded).
                    if (
                      Array.isArray(createdDescriptors) &&
                      createdDescriptors.length > 0
                    ) {
                      try {
                        const stats = await convertNotionLinksInImportedNotes(
                          createdDescriptors,
                          { updateNote, createNoteLink },
                        );
                        setNotionLinkStats(stats);
                      } catch (err) {
                        console.warn(
                          "Notion internal-link conversion step failed:",
                          err,
                        );
                      }
                    }
                  }}
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
                className="mc-display text-[20px]"
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
                {notionLinkStats.notionLinksProcessed > 0 && (
                  <>
                    {" "}
                    We also converted Notion page links to clickable notes:{" "}
                    <span className="font-semibold">
                      {notionLinkStats.linksCreated}
                    </span>{" "}
                    link{notionLinkStats.linksCreated === 1 ? "" : "s"} created
                    {notionLinkStats.dangling > 0 && (
                      <>
                        ,{" "}
                        <span className="font-semibold">
                          {notionLinkStats.dangling}
                        </span>{" "}
                        {notionLinkStats.dangling === 1 ? "link" : "links"} to
                        pages outside this import left as plain text
                      </>
                    )}
                    .
                  </>
                )}
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
                className="mc-display text-[20px]"
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

// Local copy kept for the summary card above. The shared one in
// importFlow.js is identical — we keep it here so this file has no
// behavioural dependency on importFlow's internal helper exports beyond
// the React components + the hook.
function uniqueFolderCount(pages) {
  const set = new Set();
  for (const p of pages) {
    if (p && p.path) set.add(p.path);
  }
  return set.size;
}
