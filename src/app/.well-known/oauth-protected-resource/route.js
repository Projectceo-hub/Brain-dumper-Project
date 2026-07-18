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

  return Response.json(
    {
      resource: resourceUrl,
      authorization_servers: [authorizationServerUrl],
    },
    { headers: { "Content-Type": "application/json" } },
  );
}