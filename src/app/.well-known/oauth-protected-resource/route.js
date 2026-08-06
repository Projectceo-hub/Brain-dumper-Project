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

export async function GET(request) {
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const resourceUrl = `${origin}/api/mcp`;
  const authorizationServerUrl = `${origin}`;

  // Kept in sync with the path-inserted document at
  // /.well-known/oauth-protected-resource/api/mcp — the two used to disagree,
  // this one omitting the scope and bearer-method fields.
  return Response.json(
    {
      resource: resourceUrl,
      authorization_servers: [authorizationServerUrl],
      scopes_supported: ["mcp"],
      bearer_methods_supported: ["header"],
    },
    { headers: { "Content-Type": "application/json" } },
  );
}