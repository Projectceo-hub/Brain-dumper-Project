"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
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
  parseObsidianZip,
  convertWikilinksInImportedNotes,
} from "@/lib/obsidianImport";
import {
  useImportFlow,
  PhaseSteps,
  SamplePageList,
  ProposalPreview,
  uniqueFolderCount,
} from "@/components/importFlow";

// Obsidian import flow (Phase 6 Part B + Phase 6 Part C).
//
// This page reuses the propose-then-approve state machine and the same
// AI-organize backend route as the Notion import page. What is unique to
// the Obsidian flow:
//   - The parser (parseObsidianZip) skips the .obsidian/ and .trash/
//     config folders and preserves [[wikilinks]] verbatim as literal text.
//   - AFTER approval, this page runs the Phase 6 Part C post-step —
//     `convertWikilinksInImportedNotes` — which scans every just-imported
//     note body for `[[Target]]` patterns and converts matched ones into
//     real `@[noteId|title]` mention tokens + note_link rows. Dangling
//     wikilinks become display-only `@Target` text. This step runs only on
//     the Obsidian path; the Notion import page does not import the converter.

export default function ImportObsidianPage() {
  const router = useRouter();
  const fileInputRef = useRef(null);

  // Counters surfaced in the "Import complete" card after the wikilink
  // post-step has run.
  const [wikilinkStats, setWikilinkStats] = useState({
    linksCreated: 0,
    wikilinksProcessed: 0,
    dangling: 0,
  });

  const flow = useImportFlow({ parse: parseObsidianZip, source: "obsidian" });
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
    handleStartOver: flowStartOver,
    handleAddFolderBucket,
    handleMovePage,
    handleRenameBucket,
    handleApply,
  } = flow;

  // Wrap flowStartOver so we also clear the wikilink stats when the user
  // restarts the import flow — otherwise a previous import's counters
  // would leak into the next run's done card.
  const handleStartOver = () => {
    setWikilinkStats({ linksCreated: 0, wikilinksProcessed: 0, dangling: 0 });
    flowStartOver();
  };

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

  const nonMdSkipped = extraCounts.nonMdSkipped || 0;
  const emptySkipped = extraCounts.emptySkipped || 0;
  const configSkipped = extraCounts.configSkipped || 0;

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
            Import from Obsidian
          </h1>
          <p
            className="font-sans text-sm mt-1 max-w-2xl leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            Zip your Obsidian vault folder and upload the{" "}
            <code
              className="font-mono text-xs px-1.5 py-0.5 rounded"
              style={{ background: "var(--border)", color: "var(--text-primary)" }}
            >
              .zip
            </code>{" "}
            here. We&apos;ll skip Obsidian&apos;s internal{" "}
            <code
              className="font-mono text-xs px-1.5 py-0.5 rounded"
              style={{ background: "var(--border)", color: "var(--text-primary)" }}
            >
              .obsidian/
            </code>{" "}
            and{" "}
            <code
              className="font-mono text-xs px-1.5 py-0.5 rounded"
              style={{ background: "var(--border)", color: "var(--text-primary)" }}
            >
              .trash/
            </code>{" "}
            folders, keep your{" "}
            <code
              className="font-mono text-xs px-1.5 py-0.5 rounded"
              style={{ background: "var(--border)", color: "var(--text-primary)" }}
            >
              [[wikilinks]]
            </code>{" "}
            as literal text, and show you a preview before anything is added to your account.
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
            <div
              className="mc-dropzone group cursor-pointer"
              onClick={handlePickFile}
            >
              <div className="mc-space-icon mx-auto h-10 w-10">
                <Upload size={20} strokeWidth={1.8} />
              </div>
              <div
                className="mt-3 text-[14px] font-medium"
                style={{ color: "var(--text-strong)" }}
              >
                Drop Obsidian zip
              </div>
              <div className="mt-1 text-[11px]" style={{ color: "var(--text-dim)" }}>
                Markdown + wikilinks &rarr; @mentions
              </div>
              <p
                className="mx-auto mt-3 max-w-md text-[11px] leading-relaxed"
                style={{ color: "var(--text-dim)" }}
              >
                Right-click your vault folder and choose &ldquo;Compress&rdquo;. The
                top-level{" "}
                <code className="font-mono">.obsidian/</code> folder is detected and
                skipped automatically.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                onChange={onFile}
                className="hidden"
              />
              <button type="button" onClick={handlePickFile} className="mc-link mt-2">
                Browse files
              </button>
            </div>
          )}

          {phase === "parsing" && (
            <div className="p-6" style={card}>
              <p
                className="font-sans text-sm animate-pulse"
                style={{ color: "var(--text-secondary)" }}
              >
                Reading your vault&hellip;
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
                {parsedPages.length === 1 ? "note" : "notes"} across{" "}
                {uniqueFolderCount(parsedPages)}{" "}
                {uniqueFolderCount(parsedPages) === 1 ? "folder" : "folders"}
              </h2>

              {(configSkipped > 0 || nonMdSkipped > 0 || emptySkipped > 0) && (
                <p
                  className="font-sans text-xs mt-1"
                  style={{ color: "var(--text-muted)" }}
                >
                  Skipped:
                  {configSkipped > 0
                    ? " " +
                      configSkipped +
                      " config " +
                      (configSkipped === 1 ? "file" : "files") +
                      " (.obsidian / .trash / dotfiles)"
                    : ""}
                  {nonMdSkipped > 0
                    ? (configSkipped > 0 ? "," : "") +
                      " " +
                      nonMdSkipped +
                      " non-Markdown " +
                      (nonMdSkipped === 1 ? "file" : "files") +
                      " (images, PDFs, etc.)"
                    : ""}
                  {emptySkipped > 0
                    ? (configSkipped + nonMdSkipped > 0 ? "," : "") +
                      " " +
                      emptySkipped +
                      " empty " +
                      (emptySkipped === 1 ? "note" : "notes")
                    : ""}
                  .
                </p>
              )}

              <p
                className="font-sans text-sm mt-3 leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                We&apos;ll send a summary of these notes to the AI to propose a folder layout.
                You&apos;ll see the proposal before anything is added to your MindCanvas. Any{" "}
                <code
                  className="font-mono text-xs px-1 rounded"
                  style={{ background: "var(--border)", color: "var(--text-primary)" }}
                >
                  [[wikilinks]]
                </code>{" "}
                in note bodies are preserved exactly as literal text &mdash; they are not
                converted to connections in this step.
              </p>

              <SamplePageList pages={parsedPages} />

              <div className="flex flex-wrap gap-3 mt-5">
                <button
                  type="button"
                  onClick={() =>
                    handleContinueToAI({ getAllFolders })
                  }
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
                This may take a few seconds for larger vaults.
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
                  You can move any note to a different folder before approving. Nothing is
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
                    // Phase 6 Part C: post-approval [[wikilink]] conversion.
                    // Only runs when notes were actually created; if
                    // handleApply threw partway, descriptors may be a
                    // partial list and the converter will simply process
                    // whatever is in it (it tolerates partial sets safely).
                    if (Array.isArray(createdDescriptors) && createdDescriptors.length > 0) {
                      try {
                        const stats = await convertWikilinksInImportedNotes(
                          createdDescriptors,
                          { updateNote, createNoteLink },
                        );
                        setWikilinkStats(stats);
                      } catch (err) {
                        console.warn(
                          "Obsidian wikilink conversion step failed:",
                          err,
                        );
                        // The import itself already succeeded — don't flip the
                        // card to the error state just because the post-step
                        // blew up; just leave stats at zero and continue.
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
                to your MindCanvas. We then converted{" "}
                <code
                  className="font-mono text-xs px-1 rounded"
                  style={{ background: "var(--border)", color: "var(--text-primary)" }}
                >
                  [[wikilinks]]
                </code>{" "}
                to clickable notes:{" "}
                <span className="font-semibold">{wikilinkStats.linksCreated}</span>{" "}
                link{wikilinkStats.linksCreated === 1 ? "" : "s"} created
                {wikilinkStats.dangling > 0 && (
                  <>
                    ,{" "}
                    <span className="font-semibold">{wikilinkStats.dangling}</span>{" "}
                    dangling {wikilinkStats.dangling === 1 ? "link" : "links"} left as
                    plain text
                  </>
                )}
                .
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
                  Import another vault
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
                Nothing was added to your MindCanvas. You can import a different Obsidian
                vault whenever you want.
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
