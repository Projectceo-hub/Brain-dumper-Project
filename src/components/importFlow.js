"use client";

import { useState } from "react";

// Shared propose-then-approve UI helpers used by both the Notion import
// page (/settings/import) and the Obsidian import page
// (/settings/import-obsidian). Extracted here in Phase 6 Part B so the
// Obsidian import reuses the exact same approval flow rather than
// duplicating it.
//
// Nothing in this module knows whether the imported pages came from Notion
// or Obsidian — it operates purely on the common `{title, content, path}`
// shape both parsers produce. Source-specific text lives in each page.
//
// Exports:
//   - useImportFlow()  : state machine + handlers shared by both pages.
//                        The page passes the `parse(file)` function it
//                        wants to use and the `source` ("notion" | "obsidian")
//                        it sends to /api/import-organize.
//   - <PhaseSteps />   : the numbered 1..5 step indicator at the top of the flow.
//   - <SamplePageList />: the "first N pages" preview shown at the summary step.
//   - <ProposalPreview/>: the editable AI proposal folder layout + Add folder button.
//   - <ProposalFolder />: a single bucket inside ProposalPreview (exported for
//                        testing but composed by ProposalPreview).
//   - uniqueFolderCount(): count of distinct `path`s in a parsed-pages array.

// -----------------------------------------------------------------------
// useImportFlow
// -----------------------------------------------------------------------
//
// Encapsulates the propose-then-approve state machine. The shape of `phase`
// and the rules about when writes are allowed are identical to the original
// Part A page: nothing calls createFolder/createNote before "applying",
// which only fires on explicit user approval.
//
// `parse` is the source-specific parser. The page passes `parseNotionZip`
// or `parseObsidianZip`. The parser may return slightly different extra
// counters (e.g. Notion has `htmlSkipped` + `zipsRecursed`; Obsidian has
// `configSkipped`) — the hook uses a generic `extraCounts` object so the
// page can render whatever subset makes sense for its source. The page
// owns rendering of the summary card so it can surface source-specific
// skipped-file fields.
//
// `source` is "notion" | "obsidian" and is sent to /api/import-organize
// so the backend picks the right system prompt.
export function useImportFlow({ parse, source }) {
  const [phase, setPhase] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [parsedPages, setParsedPages] = useState([]);
  const [extraCounts, setExtraCounts] = useState({});
  const [existingFolders, setExistingFolders] = useState([]);
  const [proposal, setProposal] = useState([]);
  const [applyProgress, setApplyProgress] = useState({
    foldersCreated: 0,
    notesCreated: 0,
    totalFolders: 0,
    totalNotes: 0,
  });

  const handleFileChosen = async (file) => {
    if (!file) return;
    setPhase("parsing");
    setErrorMsg("");
    try {
      const result = await parse(file);
      const pages = result.pages || [];
      // Stash every other counter (htmlSkipped, zipsRecursed, configSkipped,
      // emptySkipped, otherSkipped, nonMdSkipped, debug) so the page can
      // render the ones it cares about, source-specifically.
      const { pages: _ignored, ...rest } = result;
      setParsedPages(pages);
      setExtraCounts(rest);
      if (pages.length === 0) {
        setErrorMsg(
          "No .md notes found in this export. Please choose an export that contains Markdown (.md) files.",
        );
        setPhase("error");
        return;
      }
      setPhase("summary");
    } catch (err) {
      setErrorMsg((err && err.message) || "Failed to parse the file.");
      setPhase("error");
    }
  };

  // Calls the shared /api/import-organize route with the source flag so the
  // backend picks the Notion or Obsidian system prompt.
  const handleContinueToAI = async ({ getAllFolders }) => {
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
          source,
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

      // Re-attach content (AI response only carries title+path) by looking
      // up the original parsed page keyed by title+path.
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

      // Catch-all bucket so no parsed page silently disappears if the AI
      // omitted it from every proposed folder.
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
    setExtraCounts({});
    setErrorMsg("");
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

  // Approval step: creates the (new) folders, then notes. Real writes only
  // happen here — never earlier in the flow.
  const handleApply = async ({ createFolder, createNote }) => {
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

  return {
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
  };
}

// -----------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------

export function uniqueFolderCount(pages) {
  const set = new Set();
  for (const p of pages) {
    if (p && p.path) set.add(p.path);
  }
  return set.size;
}

export function phaseStepClass(name, currentPhase) {
  const order = ["idle", "summary", "ai", "preview", "applying", "done", "cancelled", "error"];
  const currentIdx = order.indexOf(currentPhase);
  const targetIdx = order.indexOf(name);
  const isActive = currentPhase === name;
  const isPastTarget = ["idle", "summary", "ai"].includes(name) && currentIdx > targetIdx;
  if (isActive) return "font-bold";
  if (isPastTarget) return "opacity-60 line-through";
  return "opacity-40";
}

// -----------------------------------------------------------------------
// Presentational components
// -----------------------------------------------------------------------

export function PhaseSteps({ phase }) {
  return (
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
  );
}

export function SamplePageList({ pages, max = 8 }) {
  const head = pages.slice(0, max);
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

export function ProposalPreview({ proposal, onMovePage, onRenameBucket, onAddBucket }) {
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
