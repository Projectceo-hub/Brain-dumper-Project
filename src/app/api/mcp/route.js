// MindCanvas MCP server endpoint — Streamable HTTP transport.
// Endpoint: https://YOUR_DEPLOY_URL/api/mcp
//
// Connect from an MCP client (Claude Desktop, Claude.ai, Cursor, etc.) using:
//   URL:     https://YOUR_DEPLOY_URL/api/mcp
//   Headers: Authorization: Bearer <MindCanvas API token>
//
// The token is generated in MindCanvas's Settings → API tokens page. The
// server resolves the token to a user_id, then every tool call (search notes,
// create note, etc.) operates on that user's data only — same RLS boundary
// the regular web app respects, enforced here at the application layer.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveUserFromBearer, isServiceRoleConfigured } from "@/lib/mcp/auth";
import { buildMcpServer } from "@/lib/mcp/server";

const JSONRPC_UNAUTHORIZED = {
  jsonrpc: "2.0",
  error: {
    code: -32001,
    message:
      "Unauthorized. Send an Authorization: Bearer <MindCanvas API token> header. Generate a token at /settings/tokens.",
  },
  id: null,
};

function unauthorizedResponse(request) {
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  return new Response(JSON.stringify(JSONRPC_UNAUTHORIZED), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    },
  });
}

function serviceUnavailableResponse() {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message:
          "MCP server not configured. The site operator must set SUPABASE_SERVICE_ROLE_KEY in environment.",
      },
      id: null,
    }),
    { status: 503, headers: { "Content-Type": "application/json" } },
  );
}

function optionsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    },
  });
}

async function handleRequest(request) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return optionsResponse();
  }

  // The transport expects both GET and POST. Reject everything else
  // BEFORE doing the auth check — saves a database lookup on bad methods.
  if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, POST, DELETE, OPTIONS" },
    });
  }

  // OPTIONS already handled above. GET alone doesn't require auth in some
  // server libraries (it's used to open a notification stream); we still
  // require a valid Bearer token because the stream sends the user's data.
  if (!isServiceRoleConfigured()) {
    return serviceUnavailableResponse();
  }

  const userId = await resolveUserFromBearer(request.headers.get("authorization"));
  if (!userId) {
    return unauthorizedResponse(request);
  }

  // Per-request, stateless transport: no session id is generated or
  // validated. The auth check above already established identity, so
  // every tool invocation scops to the resolved user_id.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const server = buildMcpServer(userId);
  await server.connect(transport);

  let response;
  try {
    response = await transport.handleRequest(request);
  } catch (err) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: `MCP handler error: ${err?.message || String(err)}` },
        id: null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // Close the server after the response is built so server state doesn't
  // leak between requests in this stateless model.
  try {
    await server.close();
  } catch {
    // ignore — stateless per-request server
  }

  // Decorate the response with permissive CORS so the founder can test from
  // browser-based MCP clients (e.g. Claude.ai Connectors) hosted on a
  // different origin. Headers already set by the SDK are preserved.
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function POST(request) {
  return handleRequest(request);
}

export async function GET(request) {
  return handleRequest(request);
}

export async function DELETE(request) {
  return handleRequest(request);
}

export async function OPTIONS() {
  return optionsResponse();
}
