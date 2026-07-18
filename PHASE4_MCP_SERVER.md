# MindCanvas — Phase 4 Build Prompt (MCP Server)

## Full context (assume zero prior memory — read all of this)

MindCanvas: brain-dump notes + knowledge graph app. Non-technical
"vibe coder" founder — explain plainly, don't assume deep technical
background. Strict £10/month budget — flag any new cost.

**Stack:** Next.js App Router, Tailwind, @xyflow/react, Dexie (local cache)
+ Supabase (Postgres, RLS-secured, real source of truth, email+password
auth). Deployed on Vercel, auto-deploys from GitHub
(`Projectceo-hub/Brain-dumper-Project`) on push to `main`. Live at
brain-dumper-project.vercel.app.

**AI backend:** NVIDIA NIM API (`nvidia/nemotron-3-ultra-550b-a55b`),
called from `src/app/api/organize/route.js`. Do not change this route or
model in this phase.

**Current files:** `src/lib/db.js` (Dexie + Supabase sync), `src/app/page.js`
(dashboard + sidebar + capsule input), `src/app/folder/[id]/page.js`
(folder detail + editor), `src/app/graph/page.js` (global + per-note graph),
`src/app/api/organize/route.js` (AI organize).

## What this phase builds: MindCanvas AS an MCP server

**Critical, do not get this backwards:** the goal is for MindCanvas to
become a tool that OTHER MCP clients (Claude Desktop, Claude.ai, Cursor,
etc.) can connect TO — the exact same role Notion currently plays when
someone connects "Notion" as an integration inside Claude or Cursor. This
is the OPPOSITE of MindCanvas reaching out to call other services. Do not
build an outbound integration to Notion or anything else — build
MindCanvas itself as the thing being connected to.

Concretely: the founder wants to be able to open Claude (or any other MCP
client), connect "MindCanvas" the same way they'd connect "Notion" today,
and then be able to say things like "add a note to my Projects folder
about X" or "what did I write about the Meridian project" directly inside
that other chat — with MindCanvas's own Supabase data being read/written
as a result. The end goal is for the founder to use MindCanvas itself as
their logging/notes tool going forward, the same way they currently use
Notion with Claude.

### What to build

1. **An MCP server implementation** exposing MindCanvas's own data via
   MCP tools. Use the official MCP SDK (check current docs — Python
   `mcp` package or Node/TypeScript `@modelcontextprotocol/sdk`, whichever
   fits better alongside the existing Next.js codebase; a Node/TS MCP
   server likely integrates most naturally here, but verify current best
   practice before assuming).

2. **Expose a reasonable initial set of tools**, mirroring what Notion's
   own MCP integration offers, adapted to MindCanvas's actual data model:
   - Search/fetch notes and folders (read)
   - Create a new note in a given folder (write)
   - Update an existing note's content (write)
   - List folders (read)
   - Optionally: trigger the existing `/api/organize` AI-organize flow on
     a piece of text and create the resulting notes (this would let an
     external chat say "organize this brain dump into MindCanvas" and have
     it actually happen)

3. **Authentication**: since MindCanvas already has real user accounts via
   Supabase, the MCP server needs to authenticate as a specific user's
   account when a client connects — figure out the right pattern for this
   (e.g. an API token the user generates in MindCanvas's own settings
   screen and pastes into their MCP client config, similar to how many
   self-hosted MCP servers work). Do not build something that exposes one
   user's data to any caller without proper auth — this is a real security
   requirement, not optional, since Supabase RLS policies already exist
   specifically to prevent cross-user data access, and this server must
   respect that same boundary, not bypass it.

4. **Where this runs**: figure out whether this MCP server needs to be a
   separate deployable service, or can be exposed via a route within the
   existing Next.js app (e.g. an API route implementing the MCP protocol
   over HTTP/SSE, if that's supported by the current MCP spec — check
   current docs, this has evolved over time). Prefer the simplest correct
   option that doesn't require a whole separate hosting setup if one
   exists, but don't cut corners on the auth requirement above to
   achieve that.

## What NOT to do in this phase

- Do NOT build MindCanvas as a client connecting OUT to Notion or any
  other external service — that is the wrong direction, already
  attempted once by mistake and explicitly corrected.
- Do NOT touch the AI organize route's core logic, the graph views, the
  sidebar, or the capsule input — only add what's needed to expose the
  new MCP tools (e.g. you may need to export/reuse existing functions from
  `db.js`, but don't rewrite them).
- Do NOT skip or weaken authentication to make this "simpler" — a
  MindCanvas MCP server with no auth would let anyone read/write anyone's
  notes, which is a serious security failure, not an acceptable shortcut.

## Commit/push policy

Do not commit or push without explicit confirmation first.

## When done

Report: what MCP SDK/pattern was used, how authentication works (in plain
terms — what does the user actually have to do to connect this to Claude
or Cursor), which tools were exposed, and exact step-by-step instructions
for how the founder can test this themselves by connecting it as an MCP
server inside Claude Desktop or Claude.ai.
