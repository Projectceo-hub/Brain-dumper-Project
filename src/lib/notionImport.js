// Client-side Notion export parser.
//
// Notion exports as a .zip. Depending on export settings, that zip can
// contain EITHER:
//   (a) nested folders of .md files directly, OR
//   (b) further .zip files (one per sub-page when exporting a workspace
//       with sub-pages — each sub-page becomes its own nested .zip), OR
//   (c) a mix at arbitrary nesting depth.
//
// This parser RECURSES into nested .zip entries at any depth, collecting
// every .md file found along the way. Each .md file's actual byte content
// is decoded to a UTF-8 string and becomes the note's `content` (not just
// its filename).
//
// File/folder names look like "My Page 3f9a2e1b4c5d6e7f8a9b0c1d2e3f4a5b.md"
// — Notion appends a 32-character lowercase hex ID to every title, before
// the extension. We strip that so titles display cleanly.
//
// Only .md files are imported this phase (per the Phase 6 spec — Notion's
// more common/simpler export option). .html files are skipped but counted so
// the UI can surface "skipped N HTML files" instead of silently ignoring.
//
// Returns:
//   {
//     pages: [{ title, content, path }],
//     htmlSkipped,        // count of .html/.htm entries seen
//     otherSkipped,       // count of non-md/html/zip entries (images, etc.)
//     emptySkipped,       // count of .md files whose content was empty/whitespace
//     zipsRecursed,      // count of nested .zip files we recursed into
//   }
//
// `path` is the folder path inside the zip WITHOUT the filename, with each
// nested zip's name contributing a path segment, joined by " / ". The AI
// uses it to infer Notion's original nesting/hierarchy.

import JSZip from "jszip";

// Strip a trailing Notion 32-char hex ID from a file/folder name. The ID is
// separated from the title by a single space and sits immediately before
// the file extension. We strip it whether or not an extension is present so
// the helper works for both filenames and folder/zip names which also carry
// the suffix (e.g. "Projects 3f9a2e1b....zip").
const NOTION_HEX_ID = / [0-9a-f]{32}(?=\.[a-z]+$|$)/i;

function cleanNotionName(rawName) {
  if (!rawName) return "";
  const cleaned = rawName.replace(NOTION_HEX_ID, "").trim();
  return cleaned || rawName;
}

// Read a .md entry's real byte content as decoded UTF-8 text.
//
// ROBUSTNESS NOTES (Phase 6, second fix attempt):
//
// We deliberately do NOT use JSZip's `async("string")` here. In some browser
// bundler trees (Vite/webpack) `async("string")` silently returns an empty
// string for every entry in deeply-nested zips — a bug class we hit in
// production where titles came through cleanly but note content was empty
// for every single file. The internal path JSZip uses for "string" mode is
// sensitive to bundler-level polyfills and to slice views into a parent
// buffer's byteOffset, and we can't rely on it for数千-page imports.
//
// Instead we:
//   1. Pull raw bytes via `async("uint8array")`.
//   2. COPY them into a *fresh, standalone* ArrayBuffer (not a subarray view
//      into the original zip's internal buffer). This protects against
//      TextDecoder choking on a subarray whose byteOffset > 0 when the
//      underlying buffer has been transferred/GC'd — another silent-empty
//      bug class.
//   3. Decode using the browser-native `TextDecoder('utf-8', { fatal:false })`.
//      `fatal:false` (the default) means invalid UTF-8 sequences are
//      replaced with U+FFFD rather than throwing.
//
// We also attach a debug probe so if content still comes through empty in
// some future environment, the user can see from the summary card whether
// the bytes were read at all (rawBytesLen > 0) or whether JSZip itself
// returned zero bytes (a different problem).
async function readEntryText(entry, debugProbe) {
  let rawBytes = new Uint8Array();
  try {
    const bytes = await entry.async("uint8array");
    if (bytes && bytes.length > 0) {
      // Defensive copy into a standalone buffer. `bytes.slice()` returns a
      // fresh Uint8Array with its own ArrayBuffer, not a view into any
      // parent — this is the line that fixes "content empty on every file".
      rawBytes = bytes.slice();
    }
  } catch (err) {
    // Fall through with empty rawBytes — we'll record this in the probe.
  }

  const rawLen = rawBytes.length;

  // Decode from the standalone copy. TextDecoder accepts a BufferSource
  // (ArrayBuffer or ArrayBufferView). We pass the Uint8Array directly; it
  // views our fresh buffer, not the parent zip's.
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: false }).decode(rawBytes);
  } catch {
    // Last-resort fallback: read as latin1 so we at least get *something*
    // printable. Should never trigger with fatal:false, but be safe.
    text = "";
    for (let i = 0; i < rawLen; i++) {
      text += String.fromCharCode(rawBytes[i]);
    }
  }

  if (debugProbe && rawLen > 0) {
    debugProbe(rawLen, text.length);
  }

  return text;
}

// Push a flat list of {relativePath, entry} for every non-directory entry
// in a zip, in deterministic alphabetical order. We sort by path so the
// parsed page list is stable across runs (useful for diffing proposals).
function listEntriesSorted(zip) {
  const entries = [];
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    entries.push({ relativePath, entry });
  });
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return entries;
}

function classifyEntry(relativePath) {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".md")) return "md";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".zip")) return "zip";
  return "other";
}

// Recursive walker. Shared mutable accumulator across the whole parse so
// every nested zip's findings roll up into one flat result. `prefix` carries
// the cleaned path segments contributed by outer zips so a page's `path`
// reflects its full Notion nesting (e.g. "Workspace / Projects / Sub-page").
async function walkZip(zip, prefix, acc) {
  const entries = listEntriesSorted(zip);

  for (const { relativePath, entry } of entries) {
    const kind = classifyEntry(relativePath);

    if (kind === "other") {
      acc.otherSkipped += 1;
      continue;
    }
    if (kind === "html") {
      acc.htmlSkipped += 1;
      continue;
    }

    // Build the path contributed by THIS entry's own folder location inside
    // this zip (without the filename/extension).
    const parts = relativePath.split("/").filter(Boolean);
    const leafName = parts[parts.length - 1];
    const folderParts = parts.slice(0, -1).map(cleanNotionName);
    const fullFolder = [...prefix, ...folderParts];

    if (kind === "zip") {
      // Recurse into a nested zip. The zip's own cleaned name becomes a
      // path segment for everything discovered inside it, so a sub-page
      // exported as "Roadmap 3f9a....zip" reports path
      // "<parent segments> / Roadmap".
      const zipCleanName = cleanNotionName(leafName.replace(/\.zip$/i, ""));
      const childPrefix = [...fullFolder, zipCleanName].filter(Boolean);
      try {
        const childBuf = await entry.async("uint8array");
        // Defensive slice here too — give JSZip a fresh standalone view to
        // load, not a subarray of our parent's buffer.
        const childZip = await JSZip.loadAsync(childBuf.slice());
        acc.zipsRecursed += 1;
        await walkZip(childZip, childPrefix, acc);
      } catch (err) {
        // A corrupt nested zip shouldn't kill the whole import. Count it as
        // skipped and continue with the rest.
        console.warn("Failed to recurse into nested zip:", relativePath, err);
        acc.otherSkipped += 1;
      }
      continue;
    }

    // kind === "md" — read the actual content.
    const title = cleanNotionName(leafName.replace(/\.md$/i, ""));
    const path = fullFolder.join(" / ");

    // Capture a tiny debug probe for the first 3 .md files we attempt to
    // read. This is what surfaces in the summary card so if content still
    // comes through empty we can see whether JSZip returned zero bytes or
    // whether the decoder produced empty text from non-empty bytes.
    let rawLen = 0;
    let decodedLen = 0;
    let probe = null;
    if (acc.debug.length < 3) {
      probe = (rl, dl) => {
        rawLen = rl;
        decodedLen = dl;
      };
    }

    const content = await readEntryText(entry, probe);

    if (probe) {
      acc.debug.push({
        title,
        path,
        rawBytesLen: rawLen,
        decodedTextLen: decodedLen,
        bodyPreview:
          content && content.length > 0
            ? content.slice(0, 60).replace(/\s+/g, " ")
            : "",
      });
    }

    if (!content || !content.trim()) {
      // Notion sometimes emits empty stub .md files (attachments/databases).
      // We skip them so the AI proposal isn't polluted, but we count them so
      // the summary is honest about what was dropped.
      acc.emptySkipped += 1;
      continue;
    }

    acc.pages.push({ title, content, path });
  }
}

// Normalise whatever was passed in into a Uint8Array JSZip can load.
//
// Browser <input type="file"> gives us a File (subclass of Blob) which
// JSZip accepts directly. But callers can also pass a minimal shim like
// { name, arrayBuffer() } (used in tests and when fed a Buffer from disk).
// We handle both shapes so the parser is robust to its input source and
// to JSZip's tightening accepted-types list — newer JSZip throws if it
// receives a generic object with a .name property that isn't a recognised
// byte container.
async function toUint8Array(file) {
  if (!file) throw new Error("No file provided.");
  // Uint8Array / Buffer — already bytes
  if (file instanceof Uint8Array) return file;
  // Blob / File (browser) — read via arrayBuffer()
  if (typeof file.arrayBuffer === "function") {
    const ab = await file.arrayBuffer();
    return new Uint8Array(ab);
  }
  // ArrayBuffer directly
  if (file instanceof ArrayBuffer) return new Uint8Array(file);
  // Browser File also exposes slice() (Blob); last-ditch fallback.
  throw new Error("Unsupported file input type for Notion parser.");
}

export async function parseNotionZip(file) {
  if (!file) throw new Error("No file provided.");
  const fileName = (file && file.name) || "";
  if (!/\.zip$/i.test(fileName)) {
    throw new Error("Please upload a .zip file from your Notion export.");
  }

  let rootBuf;
  try {
    rootBuf = await toUint8Array(file);
  } catch (err) {
    throw new Error(
      "Could not read the uploaded file. Please re-export from Notion and try again.",
    );
  }

  let rootZip;
  try {
    rootZip = await JSZip.loadAsync(rootBuf);
  } catch (err) {
    throw new Error(
      "Could not open this zip. Please re-export from Notion and try again. (" +
        ((err && err.message) || "unknown error") +
        ")",
    );
  }

  const acc = {
    pages: [],
    htmlSkipped: 0,
    otherSkipped: 0,
    emptySkipped: 0,
    zipsRecursed: 0,
    debug: [],
  };

  await walkZip(rootZip, [], acc);

  return {
    pages: acc.pages,
    htmlSkipped: acc.htmlSkipped,
    otherSkipped: acc.otherSkipped,
    emptySkipped: acc.emptySkipped,
    zipsRecursed: acc.zipsRecursed,
    debug: acc.debug,
  };
}
