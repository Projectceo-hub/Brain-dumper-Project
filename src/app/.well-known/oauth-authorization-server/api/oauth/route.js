// /.well-known/oauth-authorization-server/api/oauth
//
// RFC 8414 §3.1 path-insertion location for the authorization server whose
// issuer is <origin>/api/oauth. A client that reads authorization_servers:
// ["<origin>/api/oauth"] from the protected-resource document derives THIS URL
// (well-known segment inserted between host and the issuer's path) to fetch AS
// metadata. The bare /.well-known/oauth-authorization-server document is kept
// for clients that don't do path insertion; both return the same payload.

import { getDiscoveryMetadata } from "@/lib/oauth/discovery";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const metadata = await getDiscoveryMetadata(request);
  return Response.json(metadata, {
    headers: { "Content-Type": "application/json" },
  });
}
