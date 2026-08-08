// /.well-known/oauth-protected-resource/api/mcp
//
// RFC 9728 protected-resource metadata for the MCP server at /api/mcp. The
// resource path is inserted after the well-known segment, so THIS is the
// document a client fetches after a 401 on /api/mcp — and it is what the
// WWW-Authenticate header on that route points to.
//
// Every URL comes from NEXT_PUBLIC_APP_URL, falling back to the incoming
// request. These were previously hardcoded to one production hostname, which
// meant the document advertised the wrong resource on any other domain
// (preview deployments, a custom domain, localhost). A `resource` value that
// does not match the URL the user actually entered fails the client's
// validation and aborts the OAuth flow.
//
// The bare /.well-known/oauth-protected-resource document must stay identical
// to this one — see the note there.

import { resolvePublicOrigin, resolveOAuthIssuer } from "@/lib/publicOrigin";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const origin = resolvePublicOrigin(request);

  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      // Per RFC 9728 these are ISSUER IDENTIFIERS, not metadata URLs — the
      // client appends /.well-known/oauth-authorization-server itself. Our
      // issuer is the bare origin, so what the client derives is exactly
      // <origin>/.well-known/oauth-authorization-server. Putting that full
      // metadata URL here instead would make a compliant client fetch
      // /.well-known/oauth-authorization-server/.well-known/oauth-authorization-server.
      authorization_servers: [resolveOAuthIssuer(request)],
      scopes_supported: ["mcp"],
      bearer_methods_supported: ["header"],
    },
    { headers: { "Content-Type": "application/json" } },
  );
}
