// /.well-known/oauth-protected-resource
//
// Per the MCP authorization spec (and Anthropic's documentation), this
// endpoint serves a JSON document describing the protected resource —
// the MCP server at /api/mcp.
//
// Claude reads this metadata AFTER receiving a 401 response with the
// WWW-Authenticate header pointing here. The `resource` field must match
// the URL the user entered for the MCP server exactly; mismatches break
// the OAuth flow.
//
// Byte-for-byte identical to the path-inserted document at
// /.well-known/oauth-protected-resource/api/mcp. The two used to disagree:
// this one omitted the scope and bearer-method fields, and — because it was
// missing `force-dynamic` — Next could prerender it at build time and freeze a
// build-time host into `resource`, so it also disagreed about the origin.
// Whichever document the client happened to read decided whether the flow
// survived validation.

import { resolvePublicOrigin } from "@/lib/publicOrigin";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const origin = resolvePublicOrigin(request);

  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["mcp"],
      bearer_methods_supported: ["header"],
    },
    { headers: { "Content-Type": "application/json" } },
  );
}
