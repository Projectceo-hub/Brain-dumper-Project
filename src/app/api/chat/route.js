// Phase 10 — Chat with Notes, agentic tool-calling edition.
//
// POST /api/chat
//   Body:     { messages: Array<{ role, content }>, userId?: string }
//   Returns:  { reply: string } | { error: string }
//
// The model no longer receives a snapshot of the user's notes in its prompt.
// Instead it is given four read-only tools and queries the notes on demand,
// so the answer reflects the notes as they are right now and the prompt no
// longer scales with vault size.
//
// Auth note: the caller sends userId for symmetry with the rest of the
// client API, but it is NEVER trusted for authorization. Identity comes
// from the Supabase session cookie via getAuthenticatedUser() — the same
// pattern /api/tokens, /api/export and /api/account use. Every tool below
// runs on that session's RLS-scoped client and additionally pins user_id,
// so a tool can only ever reach the caller's own rows.

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

const MAX_TOKENS = 1024;
// 6 proved tight under test: a vague question against a sparse vault spent 5
// iterations on repeated searches before answering, and exhausting the budget
// yields the fallback string instead of a real answer.
const MAX_ITERATIONS = 8;
const SEARCH_LIMIT = 10;
const SNIPPET_CHARS = 200;
const DAILY_LIMIT = 30;

const FALLBACK_REPLY =
  "I wasn't able to complete that — please try again.";

const TOOL_ERROR = { error: "could not retrieve data" };

// Up to MAX_ITERATIONS sequential calls to a 550B model can run well past
// the 10s serverless default. Without this the loop is killed mid-flight in
// production even though it works locally.
export const maxDuration = 60;

const SYSTEM_PROMPT =
  "You are an intelligent AI assistant embedded in MindCanvas, a personal notes app. You have access to tools that let you search and retrieve the user's notes in real time. Always use tools to look up information before answering — never guess or make up note content. Be concise and direct. When referencing a note, mention its title.";

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI-compatible function-calling schema)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_notes",
      description:
        "Search the user's notes by keyword. Returns matching note titles and content snippets.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "keyword or phrase to search for",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_note_count",
      description:
        "Returns the total number of notes the user has. This is the same figure shown on the app's home screen.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_folders",
      description:
        "Returns all folder/space names the user has created, each with the number of notes it contains. Use this to answer questions about spaces, including which space is largest.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_note",
      description:
        "Retrieves the full content of a specific note by its title.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              "exact or partial title of the note to retrieve",
          },
        },
        required: ["title"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

// Builds a substring ILIKE pattern from a model-authored string.
//
// Only the LIKE metacharacters are escaped (\ first, so it can't double-
// escape). Without this a query of "%" matches the entire vault.
//
// Punctuation is deliberately PRESERVED. An earlier version replaced
// , ( ) " with spaces because the .or() filter below parsed on those
// characters — but the stored title keeps its punctuation, so the mangled
// pattern then matched nothing: get_note("Meeting notes (Q3), final")
// searched for "%Meeting notes  Q3   final%" and always came back empty.
// Querying each column separately removes the filter-syntax hazard, so the
// pattern can stay faithful to what the user actually typed.
function toIlikePattern(value) {
  const escaped = String(value ?? "")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/[%_]/g, (ch) => `\\${ch}`);
  return escaped ? `%${escaped}%` : null;
}

async function searchNotes(query, supabase, userId) {
  const raw = String(query ?? "").trim();
  const pattern = toIlikePattern(query);
  // Observed under test: the model sometimes calls search_notes with no
  // arguments. Returning [] reads as "nothing found" and it burns another
  // iteration re-searching; naming the problem gets it right next turn.
  if (!pattern) {
    return { error: "search_notes requires a non-empty query string." };
  }

  // Two single-column queries instead of one .or(): a lone filter carries
  // its value opaquely, so commas and parentheses in the query are no
  // longer able to rewrite the filter.
  const [titleRes, bodyRes] = await Promise.all([
    supabase
      .from("notes")
      .select("id, title, body")
      .eq("user_id", userId)
      .ilike("title", pattern)
      .limit(SEARCH_LIMIT),
    supabase
      .from("notes")
      .select("id, title, body")
      .eq("user_id", userId)
      .ilike("body", pattern)
      .limit(SEARCH_LIMIT),
  ]);

  if (titleRes.error || bodyRes.error) {
    console.error(
      "Tool search_notes failed:",
      titleRes.error || bodyRes.error,
    );
    return TOOL_ERROR;
  }

  // Title hits first — a note named after the query is a stronger match
  // than one that merely mentions it in passing.
  const seen = new Set();
  const merged = [];
  for (const note of [...(titleRes.data || []), ...(bodyRes.data || [])]) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    merged.push({
      title: note.title || "Untitled",
      snippet: (note.body || "").slice(0, SNIPPET_CHARS),
    });
    if (merged.length >= SEARCH_LIMIT) break;
  }

  if (merged.length === 0) {
    // An empty array reads as "no data" to the model and invites it to
    // retry the same query; saying so plainly ends the loop sooner.
    return { results: [], message: `No notes match "${raw}".` };
  }

  return merged;
}

// Counts TOP-LEVEL notes only, i.e. the same population the dashboard shows.
//
// createNotesFromTree writes brain-dump results as a recursive tree, so the
// notes table holds far more rows than the user thinks of as "my notes" —
// a raw COUNT(*) reported 196 against a home screen reading 47. Every count
// the UI displays goes through getNotesInFolder / getAllNotesWithFolders,
// both of which drop rows with a parent, so this filter matches them.
async function getNoteCount(supabase, userId) {
  const { count, error } = await supabase
    .from("notes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("parent_note_id", null);

  if (error) {
    console.error("Tool get_note_count failed:", error);
    return TOOL_ERROR;
  }

  return { count: count || 0 };
}

// Returns each space with how many notes it holds.
//
// Names alone were not enough: asked "which space has the most stuff", the
// model called search_notes("Ideas"), search_notes("Meetings")... i.e. it
// searched note BODIES for the folder name, which answers a different
// question entirely. Counting here is one extra query and removes the guess.
//
// note_count uses the same top-level-only rule as get_note_count so the two
// tools can never contradict each other.
async function listFolders(supabase, userId) {
  const [foldersRes, notesRes] = await Promise.all([
    supabase
      .from("folders")
      .select("id, name")
      .eq("user_id", userId)
      .order("name", { ascending: true }),
    supabase
      .from("notes")
      .select("folder_id")
      .eq("user_id", userId)
      .is("parent_note_id", null),
  ]);

  if (foldersRes.error || notesRes.error) {
    console.error(
      "Tool list_folders failed:",
      foldersRes.error || notesRes.error,
    );
    return TOOL_ERROR;
  }

  const counts = new Map();
  for (const note of notesRes.data || []) {
    const key = String(note.folder_id);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  // PostgREST has no DISTINCT; dedupe by name here. Set/Map preserve
  // insertion order, so the result stays alphabetical.
  const seen = new Set();
  const folders = [];
  for (const folder of foldersRes.data || []) {
    if (!folder.name || seen.has(folder.name)) continue;
    seen.add(folder.name);
    folders.push({
      name: folder.name,
      note_count: counts.get(String(folder.id)) || 0,
    });
  }

  return folders;
}

async function getNote(title, supabase, userId) {
  const raw = String(title ?? "").trim();
  const pattern = toIlikePattern(title);
  if (!pattern) return TOOL_ERROR;

  const { data, error } = await supabase
    .from("notes")
    .select("title, body")
    .eq("user_id", userId)
    .ilike("title", pattern)
    .limit(1);

  if (error) {
    console.error("Tool get_note failed:", error);
    return TOOL_ERROR;
  }

  const note = (data || [])[0];
  if (!note) return { error: `No note found matching "${raw}"` };

  return { title: note.title || "Untitled", content: note.body || "" };
}

// Dispatches one tool call. Never throws: a failure is returned as a result
// object so the model can read it and decide what to do next.
async function executeTool(name, args, supabase, userId) {
  try {
    switch (name) {
      case "search_notes":
        return await searchNotes(args?.query, supabase, userId);
      case "get_note_count":
        return await getNoteCount(supabase, userId);
      case "list_folders":
        return await listFolders(supabase, userId);
      case "get_note":
        return await getNote(args?.title, supabase, userId);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    console.error(`Tool ${name} threw:`, err);
    return TOOL_ERROR;
  }
}

function parseToolArguments(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === "object") return rawArgs;
  try {
    return JSON.parse(rawArgs);
  } catch {
    // A malformed argument blob is handled as "no arguments" — the tool
    // then returns its own error and the model gets a chance to retry.
    console.warn("Could not parse tool arguments:", rawArgs);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Rate limiting (unchanged from the pre-tool-calling route)
// ---------------------------------------------------------------------------

// The chat_usage table ships in supabase/migrations/20260804_chat_rate_limit.sql.
// If the operator hasn't applied that migration yet we log and let the request
// through rather than breaking chat entirely — the same "treat a missing
// relation as 'feature not provisioned'" stance db.js takes for note_links.
function isMissingRelation(error) {
  const msg = error?.message || "";
  return error?.code === "42P01" || /relation .*chat_usage/i.test(msg) ||
    /could not find the table/i.test(msg);
}

// Returns null when the request may proceed, or a NextResponse to return.
async function enforceRateLimit(supabase, userId) {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("chat_usage")
    .select("call_count")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      console.warn(
        "chat_usage table missing — rate limiting disabled until the migration is applied.",
      );
      return null;
    }
    console.error("Chat rate-limit lookup failed:", error);
    return NextResponse.json(
      { error: "Could not verify usage limit" },
      { status: 500 },
    );
  }

  const used = data?.call_count || 0;
  if (used >= DAILY_LIMIT) {
    return NextResponse.json(
      {
        error: `You've used your ${DAILY_LIMIT} daily AI chat sessions. Resets at midnight.`,
      },
      { status: 429 },
    );
  }

  const { error: writeError } = await supabase
    .from("chat_usage")
    .upsert(
      { user_id: userId, date: today, call_count: used + 1 },
      { onConflict: "user_id,date" },
    );

  // A failed counter write must not cost the user their answer; the next
  // request re-reads the row and picks the count back up.
  if (writeError && !isMissingRelation(writeError)) {
    console.error("Chat usage increment failed:", writeError);
  }

  return null;
}

// ---------------------------------------------------------------------------
// NVIDIA NIM
// ---------------------------------------------------------------------------

// Reasoning is disabled through the chat template, NOT through a top-level
// `thinking` field — NIM rejects that outright with
// `400 Validation: Unsupported parameter(s): thinking`.
//
// Measured against the live endpoint: this model emits tool_calls whether
// reasoning is on or off, so this is not what makes tool calling work. It is
// here because reasoning tokens are billed against max_tokens and can starve
// the final answer, and because this assistant answers short lookup
// questions that gain nothing from a reasoning pass.
const REASONING_OFF = { chat_template_kwargs: { thinking: false } };

// The shared NIM endpoint sheds load with a transient
// `503 ResourceExhausted: Worker local total request limit reached`. One
// such blip anywhere in the agentic loop would otherwise fail the whole
// request, so capacity errors get one retry before giving up.
const RETRY_STATUSES = new Set([429, 503]);
const RETRY_DELAY_MS = 900;

// Resolves to { message, finishReason } on success, or { errorResponse } to
// be returned straight to the client.
async function callNim(messages, apiKey) {
  let response;

  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        ...REASONING_OFF,
        max_tokens: MAX_TOKENS,
      }),
    });

    if (response.ok || !RETRY_STATUSES.has(response.status)) break;

    console.warn(
      `NVIDIA API capacity error ${response.status}; retrying once.`,
    );
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error("NVIDIA API failed:", response.status, errText);
    return {
      errorResponse: NextResponse.json(
        { error: "AI service error" },
        { status: 502 },
      ),
    };
  }

  const data = await response.json();
  const choice = data.choices?.[0];

  return {
    message: choice?.message || null,
    finishReason: choice?.finish_reason || null,
  };
}

export async function POST(request) {
  try {
    const { supabase, user } = await getAuthenticatedUser();
    if (!supabase || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const incoming = Array.isArray(body?.messages) ? body.messages : null;
    if (!incoming || incoming.length === 0) {
      return NextResponse.json({ error: "No messages provided" }, { status: 400 });
    }

    const cleanMessages = incoming
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim(),
      )
      .map((m) => ({ role: m.role, content: m.content }));

    if (cleanMessages.length === 0) {
      return NextResponse.json({ error: "No messages provided" }, { status: 400 });
    }

    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "NVIDIA API key not configured in environment" },
        { status: 500 },
      );
    }

    const limited = await enforceRateLimit(supabase, user.id);
    if (limited) return limited;

    // ----------------------------- agentic loop ---------------------------
    const conversation = [
      { role: "system", content: SYSTEM_PROMPT },
      ...cleanMessages,
    ];

    let finalReply = null;
    let lastText = "";
    let exhausted = true;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const { message, finishReason, errorResponse } = await callNim(
        conversation,
        apiKey,
      );
      if (errorResponse) return errorResponse;

      if (!message) {
        console.error("NVIDIA returned no message on iteration", i);
        exhausted = false;
        break;
      }

      // Some responses carry prose alongside tool calls; keep the most
      // recent one as a fallback in case the loop runs out of iterations.
      if (typeof message.content === "string" && message.content.trim()) {
        lastText = message.content.trim();
      }

      const toolCalls = Array.isArray(message.tool_calls)
        ? message.tool_calls
        : [];

      if (finishReason === "tool_calls" || toolCalls.length > 0) {
        // The assistant turn must be appended verbatim — the tool results
        // below are matched to it by tool_call_id.
        conversation.push(message);

        // A single turn can request several tools at once. Every tool_call_id
        // needs its own reply or the next request is malformed, so all of
        // them are executed rather than just the first.
        for (const call of toolCalls) {
          const name = call?.function?.name;
          const args = parseToolArguments(call?.function?.arguments);
          const result = await executeTool(name, args, supabase, user.id);

          conversation.push({
            role: "tool",
            tool_call_id: call?.id,
            name,
            content: JSON.stringify(result),
          });
        }

        continue;
      }

      // Plain text turn — this is the answer.
      exhausted = false;
      const text = (message.content || "").trim();
      if (text) finalReply = text;
      break;
    }

    if (!finalReply) {
      // Ran the full budget while still calling tools: hand back whatever
      // prose the model produced along the way, else the fallback line.
      if (exhausted) {
        finalReply = lastText || FALLBACK_REPLY;
      } else {
        console.error("Chat loop ended without a reply");
        return NextResponse.json(
          { error: "No response generated" },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ reply: finalReply });
  } catch (error) {
    console.error("Internal Server Error in Chat Route:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
