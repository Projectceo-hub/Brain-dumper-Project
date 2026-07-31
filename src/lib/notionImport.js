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

// Capturing counterpart of NOTION_HEX_ID.
//
// `cleanNotionName` above uses the non-capturing constant purely to STRIP
// the id so titles read nicely. That threw away the only stable identifier
// Notion gives us: the slugified-title portion of a page name/URL drifts
// whenever a page is renamed, but this 32-hex id does not. We now also
// extract it, so internal-page links can be resolved by id rather than by
// a title that may have changed.
//
// Kept as a separate regex rather than reusing/refactoring the original —
// same pattern, but with a capture group and anchored identically.
const NOTION_HEX_ID_CAPTURE = / ([0-9a-f]{32})(?=\.[a-z]+$|$)/i;

// Extracts the 32-hex Notion page id from an exported file/folder name.
// Returns a lowercased id, or null when the name carries no id (hand-made
// files, or exports from tools that strip the suffix).
export function extractNotionPageIdFromName(rawName) {
  if (!rawName || typeof rawName !== "string") return null;
  const m = NOTION_HEX_ID_CAPTURE.exec(rawName);
  return m ? m[1].toLowerCase() : null;
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
    const bareLeafName = leafName.replace(/\.md$/i, "");
    const title = cleanNotionName(bareLeafName);
    const path = fullFolder.join(" / ");
    // Stable identity for internal-link resolution. Null for files whose
    // name carries no id — those simply can't be link targets.
    const notionPageId = extractNotionPageIdFromName(bareLeafName);

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

    acc.pages.push({ title, content, path, notionPageId });
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

// ---------------------------------------------------------------------------
// Phase 6 Part C: Notion internal-page link → @mention conversion
// ---------------------------------------------------------------------------
//
// Notion's Markdown export renders an internal page link as a standard
// Markdown link whose href is an absolute app.notion.com URL:
//
//   See also: [MC Link Test — Target Page](https://app.notion.com/p/MC-Link-Test-Target-Page-3ad3ce7d8fc881b1a79cfb112a24113d?pvs=21)
//
// The link text is the target page's title verbatim, and the URL ends in
// {slugified-title}-{32-hex-page-id} plus an optional query string. Only
// the 32-hex id is stable — the slug is derived from the title and drifts
// on rename — so we match on the id and never parse the slug.
//
// This mirrors `convertWikilinksInImportedNotes` in obsidianImport.js rule
// for rule; that function is deliberately NOT touched or shared. The rules:
//
//   1. Match by 32-hex Notion page id against other pages in the SAME
//      import run (createdDescriptors), using the id embedded in each
//      exported file's own filename. Same batch-scoping as Obsidian, which
//      exists to avoid false positives against pre-existing notes.
//
//   2. Matched → replace the whole `[text](url)` with `@[matchedNoteId|Title]`
//      in the body (via updateNote) and call createNoteLink(thisNoteId,
//      matchedNoteId) to record a real connection.
//
//   3. No match (target page wasn't included in this export, or has no id)
//      → replace the whole Markdown link with the display-only `@Text`
//      form, exactly as a dangling [[wikilink]] is handled. No note_links
//      row. The editor renders it as plain non-clickable text.
//
//   4. A page linking to itself is treated as dangling, matching Obsidian
//      (and createNoteLink refuses self-links anyway).
//
//   5. Fully offline. The URL is never fetched — it is only pattern-matched.
//
// Markdown links that are NOT Notion page links (external URLs, images,
// relative paths) are left completely untouched and are not counted.

// A Markdown link: [text](url). Link text may not contain `]` or a newline.
const NOTION_MD_LINK_RE = /\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)/g;

// A Notion host. app.notion.com is what current exports emit; notion.so and
// www.notion.so are accepted too because older/other exports use them and
// the 32-hex id requirement below already makes false positives unlikely.
const NOTION_HOST_RE =
  /^https?:\/\/(?:[a-z0-9-]+\.)*notion\.(?:com|so)\//i;

// The 32-hex page id sits at the very end of the URL path — immediately
// before `?`/`#` or the end of the string. Anchoring it this way means we
// never depend on the slug portion.
const NOTION_URL_PAGE_ID_RE = /([0-9a-f]{32})(?=[?#]|$)/i;

// A RELATIVE link to another exported .md file. This is what Notion
// actually emits when the linked page is included in the same export
// (subpages under a parent), instead of an absolute app.notion.com URL:
//
//   MC%20Link%20Test%20%E2%80%94%20Target%20Page%203ad3ce7d8fc881b1a79cfb112a24113d.md
//
// The title portion is percent-encoded but the id and the extension never
// are, so anchoring on ".md" always yields the 32 hex chars immediately
// before the extension. Only one position in the string can satisfy
// "32 hex chars followed directly by .md", so this is unambiguous even
// though the encoded separator (%20) ends in a hex-looking digit.
const NOTION_MD_PATH_ID_RE = /([0-9a-f]{32})\.md(?:[?#]|$)/i;

// Returns the lowercased 32-hex page id for a Notion internal-page link, or
// null if this href isn't one. Pure string work — no network access.
//
// Handles both shapes a Notion Markdown export produces:
//   1. Absolute:  https://app.notion.com/p/Some-Title-{32hex}?pvs=21
//                 (emitted when the target page is NOT in this export)
//   2. Relative:  Some%20Title%20{32hex}.md  — or the already-decoded
//                 "Some Title {32hex}.md" — emitted when the target page
//                 IS in the same export.
export function extractNotionPageIdFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const raw = url.trim();
  if (!raw) return null;

  // Absolute URLs stay host-gated so a 32-hex id sitting in some unrelated
  // third-party URL is never mistaken for a Notion page.
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//");
  if (isAbsolute) {
    if (!NOTION_HOST_RE.test(raw)) return null;
    const m = NOTION_URL_PAGE_ID_RE.exec(raw);
    if (m) return m[1].toLowerCase();
    // An absolute Notion URL can still point straight at an exported file.
    const md = NOTION_MD_PATH_ID_RE.exec(raw);
    return md ? md[1].toLowerCase() : null;
  }

  // Relative path — must end in {32hex}.md to count. Try the raw form
  // first, then a percent-decoded form in case the export encoded the
  // extension separator too. Decoding can throw on malformed sequences,
  // so it is guarded and simply skipped when it fails.
  const candidates = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) candidates.push(decoded);
  } catch {
    // Malformed percent-encoding — the raw attempt above still stands.
  }

  for (const candidate of candidates) {
    const m = NOTION_MD_PATH_ID_RE.exec(candidate);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// `createdDescriptors` is the array returned by importFlow's handleApply:
// { noteId, folderId, title, content, notionPageId }. The db helpers are
// passed in explicitly to keep this file a pure parser with no circular
// import back into the editor/db layer — same contract the Obsidian
// converter uses.
//
// Returns { linksCreated, notionLinksProcessed, dangling } for the import
// page's "Import complete" card.
export async function convertNotionLinksInImportedNotes(
  createdDescriptors,
  { updateNote, createNoteLink },
) {
  let linksCreated = 0;
  let notionLinksProcessed = 0;
  let dangling = 0;

  if (!Array.isArray(createdDescriptors) || createdDescriptors.length === 0) {
    return { linksCreated, notionLinksProcessed, dangling };
  }

  // Build a Notion page id → descriptor lookup for the just-imported set.
  // Pages whose filename carried no id can't be link targets, so they are
  // simply absent from the map.
  const importedByPageId = new Map();
  for (const d of createdDescriptors) {
    if (d && d.notionPageId) {
      importedByPageId.set(String(d.notionPageId).toLowerCase(), d);
    }
  }

  for (const { noteId, content } of createdDescriptors) {
    if (!content || typeof content !== "string") continue;
    let body = content;

    const replacements = [];
    let m;
    NOTION_MD_LINK_RE.lastIndex = 0;
    while ((m = NOTION_MD_LINK_RE.exec(body)) !== null) {
      const linkText = (m[1] || "").trim();
      const url = m[2] || "";

      const targetPageId = extractNotionPageIdFromUrl(url);
      // Not a Notion internal-page link — leave it exactly as authored.
      if (!targetPageId) continue;

      notionLinksProcessed += 1;

      const match = importedByPageId.get(targetPageId);
      if (match && String(match.noteId) !== String(noteId)) {
        replacements.push({
          index: m.index,
          length: m[0].length,
          replacement: `@[${match.noteId}|${match.title || linkText}]`,
          targetNoteId: match.noteId,
        });
      } else {
        // Dangling → display-only `@Text`, identical to the Obsidian path.
        dangling += 1;
        replacements.push({
          index: m.index,
          length: m[0].length,
          replacement: `@${linkText || "Untitled"}`,
          targetNoteId: null,
        });
      }
    }

    if (replacements.length === 0) continue;

    // Apply in reverse order so earlier indices stay valid.
    for (let i = replacements.length - 1; i >= 0; i--) {
      const r = replacements[i];
      body =
        body.slice(0, r.index) + r.replacement + body.slice(r.index + r.length);
    }

    try {
      await updateNote(noteId, { body });
    } catch (err) {
      console.warn(
        "convertNotionLinksInImportedNotes: updateNote failed for note " +
          noteId +
          ":",
        err,
      );
    }

    for (const r of replacements) {
      if (!r.targetNoteId) continue;
      try {
        await createNoteLink(noteId, r.targetNoteId);
        linksCreated += 1;
      } catch (err) {
        console.warn(
          "convertNotionLinksInImportedNotes: createNoteLink failed for " +
            noteId +
            " -> " +
            r.targetNoteId +
            ":",
          err,
        );
      }
    }
  }

  return { linksCreated, notionLinksProcessed, dangling };
}
