// /.well-known/oauth-authorization-server
//
// RFC 8414 metadata for this deployment's authorization server. The issuer is
// the bare origin, so this is the ONE location a client derives — there is no
// path-inserted variant.
//
// force-dynamic is required: the payload is built from the request origin, and
// without it Next can prerender this at build time and freeze a build-time
// host into every advertised endpoint.

import { getDiscoveryMetadata } from "@/lib/oauth/discovery";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const metadata = await getDiscoveryMetadata(request);
  return Response.json(metadata, {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
