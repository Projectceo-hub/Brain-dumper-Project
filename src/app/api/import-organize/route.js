// POST /api/import-organize
//
// Takes a parsed page list (from a Notion export OR an Obsidian vault) + the
// user's existing MindCanvas folders, and asks the NVIDIA NIM backend (same
// model + endpoint as /api/organize) to propose a target folder for each
// imported page — either an existing MindCanvas folder (matched by name) or
// a brand-new folder name.
//
// This route is PROPOSE-ONLY. It never writes anything. The frontend renders
// the proposal for explicit user approval; note/folder creation happens in
// the client via the existing createFolder/createNote helpers in src/lib/db.js.
//
// Request body:
//   {
//     pages: [{ title, content, path }],
//     existingFolders: [{ id, name }],
//     source?: "notion" | "obsidian"   // optional, defaults to "notion"
//   }
//
// Response:
//   {
//     proposedFolders: [{ name, isNew, pages: [{ title, path }] }]
//   }
//
// `isNew` is true when the AI proposes a folder that doesn't match any
// existing folder name. The frontend resolves a proposed "existing" name
// back to its folder id — defensive code on both sides guards against the
// AI inventing a name that doesn't match any real folder.
//
// The `source` field only changes the system-prompt wording (so the AI
// understands whether nesting came from Notion or Obsidian). The response
// shape, caps, defensive normalization, and fallback behaviour are
// IDENTICAL for both sources — the Obsidian import reuses this same route
// rather than getting its own, per the Phase 6 Part B "reuse not duplicate"
// instruction.
//
// Defensive normalization mirrors /api/organize/route.js: strip code fences,
// JSON.parse with try/catch, fall back to a sensible default proposal if the
// AI output is unparseable (one bucket per page so nothing is dropped).

import { NextResponse } from "next/server";

const NOTION_PROMPT = `You organize a Notion export into a MindCanvas knowledge graph.

You receive a list of imported pages (with their original Notion folder path) and the user's existing MindCanvas folders. Propose which folder each page should land in.

Return ONLY valid JSON with this exact shape — no markdown, no code fences:
{
  "proposedFolders": [
    {
      "name": "Folder name (existing MindCanvas folder name OR a new sensible one)",
      "isNew": true,
      "pages": [
        { "title": "Page title", "path": "Original Notion path" }
      ]
    }
  ]
}

Rules:
- For each page, choose exactly one target folder.
- If a page's content clearly fits one of the existing MindCanvas folders, reuse that folder's exact name and set "isNew": false. Match the existing folder name verbatim — do not paraphrase it.
- If no existing folder fits, propose a concise new folder name (Title Case, max 40 chars) and set "isNew": true.
- Preserve Notion's nesting where meaningful: pages that shared a parent folder in Notion should usually land in the same MindCanvas folder. Do not scatter siblings across unrelated folders just because their titles differ.
- Every page appears in exactly one proposedFolder's pages array — no page is dropped, no page duplicated.
- Do not invent pages that weren't in the input list.
- Return ONLY the JSON object.`;

// The Obsidian variant. The only differences from the Notion prompt are:
//   - Wording reflects that pages came from an Obsidian vault (not Notion).
//   - The nesting guidance emphasizes that Obsidian folders usually reflect
//     the user's actual organizational intent, so the AI should prefer to
//     MIRROR that structure into MindCanvas folders rather than reorganize
//     aggressively. (Notion's export folders are often arbitrary; Obsidian's
//     are not.)
//   - We explicitly tell the AI to ignore [[wikilink]] syntax in the content
//     excerpt — those are literal text and must not influence folder
//     choices. They are handled separately in Phase 6 Part C.
// The response shape and all defensive handling are IDENTICAL to Notion.
const OBSIDIAN_PROMPT = `You organize an Obsidian vault export into a MindCanvas knowledge graph.

You receive a list of imported pages (with their original Obsidian folder path) and the user's existing MindCanvas folders. Propose which folder each page should land in.

Return ONLY valid JSON with this exact shape — no markdown, no code fences:
{
  "proposedFolders": [
    {
      "name": "Folder name (existing MindCanvas folder name OR a new sensible one)",
      "isNew": true,
      "pages": [
        { "title": "Page title", "path": "Original Obsidian path" }
      ]
    }
  ]
}

Rules:
- For each page, choose exactly one target folder.
- If a page's content clearly fits one of the existing MindCanvas folders, reuse that folder's exact name and set "isNew": false. Match the existing folder name verbatim — do not paraphrase it.
- If no existing folder fits, propose a concise new folder name (Title Case, max 40 chars) and set "isNew": true.
- Obsidian folder structure usually reflects the user's actual organizational intent. Prefer to MIRROR the source folders into MindCanvas folders (reuse existing names where they match) rather than aggressively reorganize. Siblings that shared a folder in the vault should usually land in the same MindCanvas folder.
- The page content may contain Obsidian [[wikilink]] syntax. Treat any [[...]] as literal text only — do NOT use wikilinks to infer folders, and never include the bracket text in folder names. Wikilinks are resolved separately in a later phase.
- Every page appears in exactly one proposedFolder's pages array — no page is dropped, no page duplicated.
- Do not invent pages that weren't in the input list.
- Return ONLY the JSON object.`;

const MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
const ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

// Hard caps so we stay polite with free-tier rate limits:
//   - max pages per request (anything beyond this is sampled — the client
//     already truncates long content but we also cap the number of entries
//     so a 200-page export doesn't blow the prompt context window)
//   - max chars of content excerpt per page (long bodies are truncated)
const MAX_PAGES = 40;
const MAX_CONTENT_CHARS = 1200;

function excerpt(content) {
  const c = (content || "").trim();
  if (c.length <= MAX_CONTENT_CHARS) return c;
  return c.slice(0, MAX_CONTENT_CHARS) + "…";
}

function buildUserMessage(pages, existingFolders) {
  const existing = (existingFolders || [])
    .map((f) => f?.name)
    .filter(Boolean);
  const existingSection =
    existing.length > 0
      ? `Existing MindCanvas folders (reuse one of these exact names when the content fits; set isNew=false):\n${existing.map((n) => `- ${n}`).join("\n")}`
      : "No existing MindCanvas folders yet — propose new folder names for everything.";

  const pagesSection = (pages || [])
    .slice(0, MAX_PAGES)
    .map((p, i) => {
      const path = p.path ? `Path: ${p.path}\n` : "";
      return `--- PAGE ${i + 1} ---\nTitle: ${p.title}\n${path}Content:\n${excerpt(p.content)}`;
    })
    .join("\n\n");

  return `${existingSection}\n\nImported pages:\n\n${pagesSection}`;
}

// Pick the system prompt based on the declared source of the imported
// pages. Unknown / missing source defaults to the Notion prompt (the
// original behaviour) so existing callers keep working unchanged.
function systemPromptFor(source) {
  if (source === "obsidian") return OBSIDIAN_PROMPT;
  return NOTION_PROMPT;
}

// The fallback bucket label shown to the user when the AI output is
// unparseable. Source-specific so the user sees an honest label.
function fallbackBucketLabel(source) {
  return source === "obsidian" ? "Imported from Obsidian" : "Imported from Notion";
}

// Defensive normalization — coerce whatever the AI returned into the
// declared shape, dropping malformed entries rather than crashing.
function normalizeProposal(raw) {
  const folders = Array.isArray(raw?.proposedFolders) ? raw.proposedFolders : [];
  const seenPages = new Set();
  const cleaned = [];

  for (const f of folders) {
    if (!f || typeof f !== "object") continue;
    const name = typeof f.name === "string" ? f.name.trim().slice(0, 60) : "";
    if (!name) continue;
    const isNew = Boolean(f.isNew);
    const pageList = Array.isArray(f.pages) ? f.pages : [];
    const pages = [];
    for (const p of pageList) {
      if (!p || typeof p !== "object") continue;
      const title = typeof p.title === "string" ? p.title.trim() : "";
      const path = typeof p.path === "string" ? p.path : "";
      if (!title) continue;
      const key = `${title}\u0001${path}`;
      if (seenPages.has(key)) continue; // AI duplicated a page — drop the dup
      seenPages.add(key);
      pages.push({ title, path });
    }
    if (pages.length > 0) {
      cleaned.push({ name, isNew, pages });
    }
  }

  return { proposedFolders: cleaned };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const pages = Array.isArray(body?.pages) ? body.pages : [];
    const existingFolders = Array.isArray(body?.existingFolders) ? body.existingFolders : [];
    const source = body?.source === "obsidian" ? "obsidian" : "notion";

    if (pages.length === 0) {
      return NextResponse.json({ error: "No pages to organize." }, { status: 400 });
    }

    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "NVIDIA API key not configured in environment" },
        { status: 500 },
      );
    }

    const systemPrompt = systemPromptFor(source);
    const userMessage = buildUserMessage(pages, existingFolders);

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("NVIDIA API failed (import-organize):", response.status, errText);
      return NextResponse.json(
        { error: "AI service returned an error" },
        { status: 502 },
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty message content returned from NVIDIA NIM");
    }

    // Strip code fences if present.
    let raw = content.trim();
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const fallbackLabel = fallbackBucketLabel(source);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseError) {
      console.error("Failed to parse AI import proposal JSON:", parseError);
      // Fallback: bucket every page into a single catch-all folder so the
      // user still gets a reviewable proposal (and can move pages around
      // before approving). Nothing is lost.
      parsed = {
        proposedFolders: [
          {
            name: fallbackLabel,
            isNew: true,
            pages: pages.slice(0, MAX_PAGES).map((p) => ({
              title: p.title,
              path: p.path || "",
            })),
          },
        ],
      };
    }

    const normalized = normalizeProposal(parsed);

    // Final safety net: if normalization dropped everything, put all pages
    // into one fallback bucket so the preview UI still has something to show.
    if (normalized.proposedFolders.length === 0) {
      normalized.proposedFolders = [
        {
          name: fallbackLabel,
          isNew: true,
          pages: pages.slice(0, MAX_PAGES).map((p) => ({
            title: p.title,
            path: p.path || "",
          })),
        },
      ];
    }

    return NextResponse.json(normalized);
  } catch (error) {
    console.error("Import-organize route error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
