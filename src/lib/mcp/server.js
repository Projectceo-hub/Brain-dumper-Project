// Builds an McpServer instance with MindCanvas's MCP tools registered.
// Stateless — no per-session data, every tool call carries the resolved
// userId via the transport's authInfo / a closure passed by the caller.
//
// The returned server can be connected to a fresh transport per request
// (stateless Streamable HTTP pattern) so the route handler can decide the
// user identity from the Authorization header on every request.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  listFoldersForMcp,
  getFolderByIdForMcp,
  getOrCreateFolderByNameForMcp,
  listNotesForMcp,
  getNoteByIdForMcp,
  searchNotesForMcp,
  createNoteForMcp,
  updateNoteForMcp,
  createChildNoteForMcp,
  saveEntitiesForMcp,
} from "@/lib/mcp/data";

function text(content) {
  return {
    content: [{ type: "text", text: content }],
  };
}

function jsonText(label, value) {
  return text(`${label}\n\n${JSON.stringify(value, null, 2)}`);
}

function buildMcpServer(userId) {
  if (!userId) throw new Error("buildMcpServer requires a userId.");

  const server = new McpServer({
    name: "mindcanvas",
    version: "1.0.0",
  });

  // -------------------------------------------------- list_folders
  server.registerTool(
    "list_folders",
    {
      title: "List folders",
      description:
        "List all of the user's folders (a.k.a. \"spaces\") in MindCanvas. Each folder has an id, name, and last-updated timestamp.",
      inputSchema: {},
    },
    async () => {
      try {
        const folders = await listFoldersForMcp(userId);
        return text(
          `Folders (${folders.length}):\n\n` +
            folders
              .map(
                (f, i) =>
                  `${i + 1}. id=${f.id} | name=${f.name} | updatedAt=${f.updatedAt}`,
              )
              .join("\n"),
        );
      } catch (err) {
        return text(`Error listing folders: ${err.message}`);
      }
    },
  );

  // -------------------------------------------------- list_notes
  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description:
        "List top-level notes in MindCanvas. Optional folderId narrows the list to a specific folder. Optional limit (default 20, max 100). Each note has id, title, body (truncated), folderId, updatedAt.",
      inputSchema: {
        folderId: z
          .string()
          .optional()
          .describe("Folder id to scope the list. Omit to list across all folders."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max notes to return (default 20, max 100)."),
      },
    },
    async ({ folderId, limit }) => {
      try {
        const notes = await listNotesForMcp(userId, { folderId, limit });
        const folderNames = await listFoldersForMcp(userId).then((fs) =>
          Object.fromEntries(fs.map((f) => [f.id, f.name])),
        );
        return text(
          `Notes (${notes.length}):\n\n` +
            notes
              .map(
                (n, i) =>
                  `${i + 1}. id=${n.id}\n   title=${n.title || "(untitled)"}\n   folder=${folderNames[n.folderId] || n.folderId}\n   updatedAt=${n.updatedAt}\n   body=${(n.body || "").slice(0, 200)}`,
              )
              .join("\n"),
        );
      } catch (err) {
        return text(`Error listing notes: ${err.message}`);
      }
    },
  );

  // -------------------------------------------------- search_notes
  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        'Search the user\'s MindCanvas notes by keyword. Case-insensitive substring match across both title and body. e.g. "Meridian project" returns all notes mentioning "Meridian project" anywhere in their text.',
      inputSchema: {
        query: z.string().min(1).describe("Free-text search query."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max results (default 20, max 50)."),
      },
    },
    async ({ query, limit }) => {
      try {
        const results = await searchNotesForMcp(userId, query, { limit });
        return text(
          `Search results for "${query}" (${results.length}):\n\n` +
            results
              .map(
                (n, i) =>
                  `${i + 1}. id=${n.id}\n   title=${n.title || "(untitled)"}\n   folderId=${n.folderId}\n   updatedAt=${n.updatedAt}\n   body=${(n.body || "").slice(0, 300)}`,
              )
              .join("\n\n"),
        );
      } catch (err) {
        return text(`Error searching notes: ${err.message}`);
      }
    },
  );

  // -------------------------------------------------- get_note
  server.registerTool(
    "get_note",
    {
      title: "Get note",
      description:
        "Fetch a single MindCanvas note by id. Returns the note's full title + body content.",
      inputSchema: {
        noteId: z.string().min(1).describe("The note id (UUID) to fetch."),
      },
    },
    async ({ noteId }) => {
      try {
        const note = await getNoteByIdForMcp(userId, noteId);
        if (!note) return text(`No note found with id=${noteId}.`);
        return text(
          `Title: ${note.title || "(untitled)"}\n\nFolder ID: ${note.folderId}\nNote ID: ${note.id}\nCreated at: ${note.createdAt}\nUpdated at: ${note.updatedAt}\n\n---\n\n${note.body || "(note body is empty)"}`,
        );
      } catch (err) {
        return text(`Error fetching note: ${err.message}`);
      }
    },
  );

  // -------------------------------------------------- create_note
  server.registerTool(
    "create_note",
    {
      title: "Create note",
      description:
        'Create a new note in MindCanvas. Provide either folderId (if you know the folder id) or folderName (auto-creates the folder if it does not exist). Title defaults to the first non-empty line of body when omitted. e.g. "add a note to my Projects folder about the Meridian timeline review next week".',
      inputSchema: {
        body: z
          .string()
          .min(1)
          .describe("The full content of the note. Multi-line text is fine."),
        title: z
          .string()
          .optional()
          .describe(
            "Optional note title. If omitted, MindCanvas uses the first non-empty line of the body (max 80 chars).",
          ),
        folderId: z
          .string()
          .optional()
          .describe("Folder UUID to create the note in. Optional but faster than folderName."),
        folderName: z
          .string()
          .optional()
          .describe(
            "Folder name to create the note in. Auto-creates the folder if it doesn't exist (case-insensitive match). Examples: \"Projects\", \"Meetings\", \"Quick notes\".",
          ),
      },
    },
    async ({ body, title, folderId, folderName }) => {
      try {
        if (!folderId && !folderName) {
          return text(
            "create_note requires either a folderId or a folderName so MindCanvas knows where to put the note.",
          );
        }
        const note = await createNoteForMcp(userId, {
          title,
          body,
          folderId,
          folderName,
        });
        const folder = await getFolderByIdForMcp(userId, note.folderId);
        return text(
          `Created note.\n\nTitle: ${note.title || "(untitled)"}\nNote ID: ${note.id}\nFolder: ${folder?.name || note.folderId} (id=${note.folderId})\nUpdated at: ${note.updatedAt}\n\nBody:\n${note.body || "(empty)"}`,
        );
      } catch (err) {
        return text(`Error creating note: ${err.message}`);
      }
    },
  );

  // -------------------------------------------------- update_note
  server.registerTool(
    "update_note",
    {
      title: "Update note",
      description:
        "Update an existing MindCanvas note's title and/or body. At least one of title or body must be provided. The other field is left unchanged.",
      inputSchema: {
        noteId: z.string().min(1).describe("The note id (UUID) to update."),
        title: z
          .string()
          .optional()
          .describe("New title for the note. Pass null/omit to leave unchanged."),
        body: z
          .string()
          .optional()
          .describe("New body for the note. Pass null/omit to leave unchanged."),
      },
    },
    async ({ noteId, title, body }) => {
      try {
        if (title == null && body == null) {
          return text("update_note requires at least a title or a body to change.");
        }
        const changes = {};
        if (title != null) changes.title = title;
        if (body != null) changes.body = body;
        const note = await updateNoteForMcp(userId, noteId, changes);
        return text(
          `Updated note ${note.id}.\n\nTitle: ${note.title || "(untitled)"}\nFolder ID: ${note.folderId}\nUpdated at: ${note.updatedAt}\n\nBody:\n${note.body || "(empty)"}`,
        );
      } catch (err) {
        return text(`Error updating note: ${err.message}`);
      }
    },
  );

  // -------------------------------------------------- organize_dump
  server.registerTool(
    "organize_dump",
    {
      title: "Organize a brain dump into MindCanvas",
      description:
        'Sends a raw brain dump through MindCanvas\'s AI-organize flow (NVIDIA Nemotron) and creates the resulting structured note tree inside a folder of your choosing. The AI extracts a hierarchy of sub-topics plus named entities (people, companies, projects) and MindCanvas creates a root note plus child notes for each branch. Provide either folderId or folderName (auto-creates the folder if missing). e.g. "Organize this brain dump into my Meetings folder: <dump text>".',
      inputSchema: {
        text: z
          .string()
          .min(1)
          .describe("The raw brain-dump text to organize."),
        folderId: z
          .string()
          .optional()
          .describe("Folder UUID to create the organized notes in."),
        folderName: z
          .string()
          .optional()
          .describe(
            "Folder name to create the organized notes in. Auto-creates the folder if it doesn't exist.",
          ),
      },
    },
    async ({ text: dumpText, folderId, folderName }) => {
      try {
        if (!folderId && !folderName) {
          return text(
            "organize_dump requires either folderId or folderName so MindCanvas knows where to put the organized notes.",
          );
        }

        const folder = folderId
          ? await getFolderByIdForMcp(userId, folderId)
          : await getOrCreateFolderByNameForMcp(userId, folderName);
        if (!folder) {
          return text(`Folder not found for this user (folderId=${folderId || `"${folderName}"`}).`);
        }
        const targetFolderId = folder.id;

        // Call MindCanvas's own /api/organize endpoint. Stays within the
        // £10/mo budget (NVIDIA NIM free tier). The route is unchanged.
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
        const res = await fetch(`${baseUrl}/api/organize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: dumpText }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          return text(
            `AI organize call failed (status ${res.status}). ${errText}`.slice(0, 500),
          );
        }

        const data = await res.json();
        if (!data?.tree) {
          return text("AI organize returned no tree.");
        }

        const rootNote = await createChildNoteForMcp(
          userId,
          targetFolderId,
          data.tree,
          null,
          async (uid, refs, sourceNoteId) => {
            // The entities array is at the top of the AI response. Save
            // any entity whose name appears in the tree's entityRefs.
            if (!Array.isArray(data.entities) || data.entities.length === 0) return;
            const refSet = new Set((refs || []).map((r) => String(r).trim()));
            const relevant = data.entities.filter(
              (e) => e?.name && (refSet.size === 0 || refSet.has(e.name)),
            );
            if (relevant.length === 0) return;
            await saveEntitiesForMcp(uid, relevant, sourceNoteId);
          },
        );

        const childrenCount = Array.isArray(data.tree.children)
          ? data.tree.children.length
          : 0;
        const entityCount = Array.isArray(data.entities) ? data.entities.length : 0;

        return text(
          `Organized the brain dump into MindCanvas.\n\nRoot note:\n  ID: ${rootNote.id}\n  Title: ${rootNote.title}\nFolder: ${folder.name} (id=${targetFolderId})\nDirect child topics created: ${childrenCount}\nEntities extracted: ${entityCount}\n\nThe AI produced an arbitrarily deep tree — every branch became a nested child note in that folder. Open MindCanvas and go to "${folder.name}" to see the result.`,
        );
      } catch (err) {
        return text(`Error organizing into MindCanvas: ${err.message}`);
      }
    },
  );

  return server;
}

export { buildMcpServer };
