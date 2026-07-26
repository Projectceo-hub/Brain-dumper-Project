// Client-side Obsidian vault parser.
//
// Obsidian vaults are normally a plain folder of .md files. To keep this
// phase consistent with the Phase 6 Part A (Notion) upload pattern — and
// because browser folder-picker support is uneven — we accept the vault as
// a .zip of the vault folder. The user zips their vault folder (or the
// contents of it) and uploads the .zip here.
//
// Differences from Notion exports (handled here):
//   - No trailing 32-char hex ID on filenames — titles are the raw filename.
//   - Obsidian's folder structure is meaningful (often reflects the user's
//     real organizational intent), so we preserve it as the `path` field
//     the AI uses to infer a target folder.
//   - The vault contains a `.obsidian/` config folder (app settings, not
//     notes) and optionally a `.trash/` folder — both are skipped entirely
//     and never become imported notes. We also skip other dotfile config
//     folders defensively (`.git/`, `.obsidian-git/`, etc.) since those
//     are app-internal, not user notes.
//   - `[[wikilink]]` syntax inside note bodies is preserved EXACTLY as
//     literal text. We do NOT strip, parse, or convert it. Resolving
//     wikilinks into real connections is Phase 6 Part C and depends on
//     this phase keeping the raw `[[...]]` text intact.
//
// Only .md files are imported. Other file types (images, PDFs, etc.) are
// skipped but counted so the summary card can be honest about what was
// dropped. Empty .md files are also skipped and counted.
//
// Returns:
//   {
//     pages: [{ title, content, path }],
//     nonMdSkipped,     // count of non-md entries seen (images, configs, etc.)
//     emptySkipped,     // count of .md files whose content was empty/whitespace
//     configSkipped,    // count of entries inside skipped config folders
//                       // (.obsidian/, .trash/, other dotfiles)
//   }
//
// `path` is the folder path inside the zip WITHOUT the filename, with
// segments joined by " / ". The AI uses it to infer the vault's original
// nesting/hierarchy.

import JSZip from "jszip";

// Folders that are Obsidian-internal config / app state, not user notes.
// We match by the FIRST path segment only, so "anything/.obsidian/..." is
// skipped at the top level, and ".obsidian/..." at the root is also skipped.
// We intentionally do NOT skip these names if they appear deeper in the
// tree — only when they are a top-level vault config folder. This avoids
// accidentally dropping a user's legitimately-named "trash" subfolder inside
// their notes area while still catching Obsidian's own ".trash" recovery
// bin at the vault root.
//
// All comparisons are case-insensitive on the FIRST path segment.
const SKIP_TOP_LEVEL_FOLDERS = new Set([
  ".obsidian",
  ".trash",
  ".git",
  ".obsidian-git",
  ".vscode",
]);

function isSkippedTopLevelSegment(segment) {
  if (!segment) return false;
  return SKIP_TOP_LEVEL_FOLDERS.has(segment.toLowerCase());
}

// Read a .md entry's real byte content as decoded UTF-8 text.
//
// Same robustness approach as notionImport.js: we deliberately do NOT use
// JSZip's `async("string")` because it can silently return empty strings
// in some bundler trees. Instead we pull raw uint8 bytes, defensively copy
// them into a fresh standalone ArrayBuffer (not a subarray view into the
// parent zip buffer — that was the root cause of "content empty on every
// file" bugs in Part A), and decode with the browser-native TextDecoder
// in non-fatal mode.
//
// We do NOT touch the byte string here — `[[wikilinks]]` and everything
// else in the body is preserved byte-for-byte (modulo UTF-8 decoding of
// the raw bytes the user authored).
async function readEntryText(entry) {
  let rawBytes = new Uint8Array();
  try {
    const bytes = await entry.async("uint8array");
    if (bytes && bytes.length > 0) {
      // Fresh standalone copy — not a view into JSZip's parent buffer.
      rawBytes = bytes.slice();
    }
  } catch {
    // Fall through with empty rawBytes.
  }

  const rawLen = rawBytes.length;
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: false }).decode(rawBytes);
  } catch {
    // Last-resort latin1 fallback. Should never trigger with fatal:false.
    text = "";
    for (let i = 0; i < rawLen; i++) {
      text += String.fromCharCode(rawBytes[i]);
    }
  }
  return text;
}

function listEntriesSorted(zip) {
  const entries = [];
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    entries.push({ relativePath, entry });
  });
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return entries;
}

// Compute the "pass-through" cleaned path segments for a .md file.
//
// Obsidian filenames have NO trailing hex ID (unlike Notion), so we keep
// folder names verbatim. We only normalize path separators and drop any
// trailing slash. This is deliberately minimal — Obsidian's folder names
// carry the user's actual intent and we don't want to mutate them.
function folderSegmentsFor(relativePath) {
  const parts = relativePath.split("/").filter(Boolean);
  // Last segment is the filename; everything before it is the folder path.
  return parts.slice(0, -1);
}

export async function parseObsidianZip(file) {
  if (!file) throw new Error("No file provided.");
  const fileName = (file && file.name) || "";
  if (!/\.zip$/i.test(fileName)) {
    throw new Error("Please upload a .zip of your Obsidian vault folder.");
  }

  // Reuse the same to-Uint8Array normalization notionImport.js uses, inlined
  // here to avoid coupling the two parsers. Handles File/Blob, ArrayBuffer,
  // and Uint8Array inputs.
  let rootBuf;
  try {
    if (file instanceof Uint8Array) {
      rootBuf = file;
    } else if (typeof file.arrayBuffer === "function") {
      rootBuf = new Uint8Array(await file.arrayBuffer());
    } else if (file instanceof ArrayBuffer) {
      rootBuf = new Uint8Array(file);
    } else {
      throw new Error("Unsupported file input type.");
    }
  } catch {
    throw new Error(
      "Could not read the uploaded file. Please re-zip your vault and try again.",
    );
  }

  let rootZip;
  try {
    rootZip = await JSZip.loadAsync(rootBuf);
  } catch (err) {
    throw new Error(
      "Could not open this zip. Please re-zip your vault and try again. (" +
        ((err && err.message) || "unknown error") +
        ")",
    );
  }

  const acc = {
    pages: [],
    nonMdSkipped: 0,
    emptySkipped: 0,
    configSkipped: 0,
  };

  const entries = listEntriesSorted(rootZip);

  for (const { relativePath, entry } of entries) {
    const parts = relativePath.split("/").filter(Boolean);

    // Skip anything that lives inside a skipped top-level config folder.
    // We only check the FIRST segment so a user's nested "Notes/.trash" is
    // never confused with Obsidian's root ".trash" recovery bin.
    if (parts.length > 0 && isSkippedTopLevelSegment(parts[0])) {
      acc.configSkipped += 1;
      continue;
    }

    // Only .md files are imported this phase.
    const lower = relativePath.toLowerCase();
    if (!lower.endsWith(".md")) {
      acc.nonMdSkipped += 1;
      continue;
    }

    const leafName = parts[parts.length - 1];
    const title = leafName.replace(/\.md$/i, "");
    const folderParts = folderSegmentsFor(relativePath);
    const path = folderParts.join(" / ");

    const content = await readEntryText(entry);

    // Skip empty .md files (e.g. stub files, blank notes) so the AI
    // proposal isn't polluted. Count them so the summary is honest.
    if (!content || !content.trim()) {
      acc.emptySkipped += 1;
      continue;
    }

    // IMPORTANT: content is preserved verbatim, including any
    // [[wikilinks]] found in it. We do NOT strip, parse, or alter
    // wikilink syntax in this phase — Phase 6 Part C handles that and
    // depends on this phase keeping the raw text intact.
    acc.pages.push({ title, content, path });
  }

  return {
    pages: acc.pages,
    nonMdSkipped: acc.nonMdSkipped,
    emptySkipped: acc.emptySkipped,
    configSkipped: acc.configSkipped,
  };
}
